//! WASAPI loopback capture of the system's output mix, plus the spectrum and
//! waveform the visualizers need.
//!
//! cpal turns a *render* device into a loopback capture when `build_input_stream`
//! is called on it, so no extra Windows features and no unsafe code are needed.
//! The stream itself is `!Send` on Windows, so one dedicated thread owns it and
//! the rest of the app only sees a stop flag.
//!
//! What is emitted is deliberately raw: RMS amplitude, band magnitudes and a
//! decimated waveform. Reference level, smoothing, gain and peak hold are
//! per-part user settings, so they stay in the frontend.
//!
//! Sharing with a DAW: this is a *shared mode* stream. With Windows' default
//! setting ("Give exclusive mode applications priority") an app asking for
//! exclusive mode preempts us and we simply stop. But if the user turned that
//! priority off, a live shared-mode stream makes the exclusive request *fail* --
//! i.e. we would block the DAW. So the capture must release the device the
//! moment nothing needs it, and must not quietly restart after being preempted.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const EMIT_INTERVAL: Duration = Duration::from_millis(16); // ~60 Hz
const RING: usize = 2048; // FFT size, also the sample history kept per channel
const BANDS: usize = 64; // log-spaced bands handed to the frontend
const WAVE: usize = 128; // waveform points per channel
const WAVE_SPAN: usize = 1024; // how many recent samples the waveform covers
const BAND_LO: f32 = 30.0;
const BAND_HI: f32 = 16_000.0;
const FLOOR_DB: f32 = -70.0; // band magnitude mapped from this dB up to 0

#[derive(Clone, Serialize)]
pub struct AudioFrame {
    /// RMS amplitude per channel, 0..1. The VU meter reads this.
    pub l: f32,
    pub r: f32,
    /// Band magnitudes, 0..255 for -70..0 dB.
    pub bands: Vec<u8>,
    /// Waveform, -127..127 for -1..1.
    pub wl: Vec<i8>,
    pub wr: Vec<i8>,
}

#[derive(Clone, Serialize, Default)]
pub struct AudioStatus {
    pub running: bool,
    pub device: String,
    pub rate: u32,
    pub channels: u16,
    pub error: String,
}

struct Running {
    stop: Arc<AtomicBool>,
}

fn slot() -> &'static Mutex<Option<Running>> {
    static S: OnceLock<Mutex<Option<Running>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

fn status_slot() -> &'static Mutex<AudioStatus> {
    static S: OnceLock<Mutex<AudioStatus>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(AudioStatus::default()))
}

struct Acc {
    sum: [f64; 2],
    n: u64,
    /// Per-channel ring of the most recent samples. `w` is the write cursor.
    l: Box<[f32; RING]>,
    r: Box<[f32; RING]>,
    w: usize,
    fed: bool,
}

impl Default for Acc {
    fn default() -> Self {
        Self {
            sum: [0.0; 2],
            n: 0,
            l: Box::new([0.0; RING]),
            r: Box::new([0.0; RING]),
            w: 0,
            fed: false,
        }
    }
}

impl Acc {
    fn feed<T: Into<f64> + Copy>(&mut self, data: &[T], ch: usize, scale: f64) {
        if ch == 0 {
            return;
        }
        for f in data.chunks_exact(ch) {
            let l = f[0].into() * scale;
            let r = if ch > 1 { f[1].into() * scale } else { l };
            self.sum[0] += l * l;
            self.sum[1] += r * r;
            self.n += 1;
            self.l[self.w] = l as f32;
            self.r[self.w] = r as f32;
            self.w = (self.w + 1) % RING;
        }
        self.fed = true;
    }

    /// Oldest-to-newest copy of a ring.
    fn ordered(&self, ring: &[f32; RING], out: &mut [f32; RING]) {
        let (a, b) = ring.split_at(self.w);
        out[..b.len()].copy_from_slice(b);
        out[b.len()..].copy_from_slice(a);
    }
}

struct Analyzer {
    fft: Arc<dyn rustfft::Fft<f32>>,
    window: Vec<f32>,
    /// Inclusive FFT bin range per band, precomputed from the sample rate.
    edges: Vec<(usize, usize)>,
    buf: Vec<Complex<f32>>,
    tmp_l: Box<[f32; RING]>,
    tmp_r: Box<[f32; RING]>,
}

impl Analyzer {
    fn new(rate: u32) -> Self {
        let fft = FftPlanner::<f32>::new().plan_fft_forward(RING);
        // Hann window: without it the leakage smears every band into its neighbours.
        let window = (0..RING)
            .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / RING as f32).cos())
            .collect();
        let bin_hz = rate as f32 / RING as f32;
        let nyq_bin = RING / 2;
        let edges = (0..BANDS)
            .map(|b| {
                let f0 = BAND_LO * (BAND_HI / BAND_LO).powf(b as f32 / BANDS as f32);
                let f1 = BAND_LO * (BAND_HI / BAND_LO).powf((b + 1) as f32 / BANDS as f32);
                let lo = ((f0 / bin_hz).floor() as usize).clamp(1, nyq_bin - 1);
                // Low bands can be narrower than one bin; keep at least one.
                let hi = ((f1 / bin_hz).ceil() as usize).clamp(lo + 1, nyq_bin);
                (lo, hi)
            })
            .collect();
        Self {
            fft,
            window,
            edges,
            buf: vec![Complex { re: 0.0, im: 0.0 }; RING],
            tmp_l: Box::new([0.0; RING]),
            tmp_r: Box::new([0.0; RING]),
        }
    }

    fn run(&mut self, acc: &Acc) -> (Vec<u8>, Vec<i8>, Vec<i8>) {
        acc.ordered(&acc.l, &mut self.tmp_l);
        acc.ordered(&acc.r, &mut self.tmp_r);
        for i in 0..RING {
            let mono = (self.tmp_l[i] + self.tmp_r[i]) * 0.5;
            self.buf[i] = Complex { re: mono * self.window[i], im: 0.0 };
        }
        self.fft.process(&mut self.buf);
        // 2/N undoes the FFT scaling and the one-sided spectrum; 2.0 undoes Hann's
        // coherent gain of 0.5, so a full-scale sine reads ~0 dB.
        let norm = 4.0 / RING as f32;
        let bands = self
            .edges
            .iter()
            .map(|&(lo, hi)| {
                let mut peak = 0.0f32;
                for c in &self.buf[lo..hi] {
                    peak = peak.max(c.norm());
                }
                let db = 20.0 * (peak * norm).max(1e-9).log10();
                let v = ((db - FLOOR_DB) / -FLOOR_DB).clamp(0.0, 1.0);
                (v * 255.0).round() as u8
            })
            .collect();

        let step = WAVE_SPAN / WAVE;
        let start = RING - WAVE_SPAN;
        let pick = |src: &[f32; RING]| -> Vec<i8> {
            (0..WAVE)
                .map(|i| (src[start + i * step].clamp(-1.0, 1.0) * 127.0) as i8)
                .collect()
        };
        (bands, pick(&self.tmp_l), pick(&self.tmp_r))
    }
}

fn set_status(f: impl FnOnce(&mut AudioStatus)) {
    if let Ok(mut s) = status_slot().lock() {
        f(&mut s);
    }
}

fn capture(app: AppHandle, stop: Arc<AtomicBool>) -> Result<(), String> {
    let host = cpal::default_host();
    let dev = host
        .default_output_device()
        .ok_or_else(|| "既定の出力デバイスが見つかりません".to_string())?;
    let name = dev.name().unwrap_or_else(|_| "(不明)".into());
    // A render device reports no input configs, so the loopback stream is built
    // from the shared-mode mix format that `default_output_config` returns.
    let cfg = dev.default_output_config().map_err(|e| e.to_string())?;
    let ch = cfg.channels() as usize;
    let rate = cfg.sample_rate().0;
    let fmt = cfg.sample_format();
    let stream_cfg: cpal::StreamConfig = cfg.into();

    set_status(|s| {
        s.device = name.clone();
        s.rate = rate;
        s.channels = ch as u16;
        s.error.clear();
    });

    let acc = Arc::new(Mutex::new(Acc::default()));
    // Being preempted by an exclusive-mode app surfaces here. Record it and let
    // the loop end instead of spinning on a dead stream.
    let dead = Arc::new(AtomicBool::new(false));
    let d2 = dead.clone();
    let err_fn = move |e: cpal::StreamError| {
        eprintln!("[audio] stream error: {e}");
        d2.store(true, Ordering::Relaxed);
        set_status(|s| s.error = format!("{e}"));
    };

    let a = acc.clone();
    let stream = match fmt {
        cpal::SampleFormat::F32 => dev.build_input_stream(
            &stream_cfg,
            move |d: &[f32], _: &_| {
                if let Ok(mut g) = a.lock() {
                    g.feed(d, ch, 1.0)
                }
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => dev.build_input_stream(
            &stream_cfg,
            move |d: &[i16], _: &_| {
                if let Ok(mut g) = a.lock() {
                    g.feed(d, ch, 1.0 / 32768.0)
                }
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::U16 => dev.build_input_stream(
            &stream_cfg,
            move |d: &[u16], _: &_| {
                if let Ok(mut g) = a.lock() {
                    // u16 is unsigned PCM centred on 32768.
                    let v: Vec<f32> = d.iter().map(|&x| (x as f32 - 32768.0) / 32768.0).collect();
                    g.feed(&v, ch, 1.0)
                }
            },
            err_fn,
            None,
        ),
        other => return Err(format!("未対応のサンプル形式です: {other:?}")),
    }
    .map_err(|e| e.to_string())?;

    stream.play().map_err(|e| e.to_string())?;
    set_status(|s| s.running = true);

    let mut an = Analyzer::new(rate);
    let silent = AudioFrame {
        l: 0.0,
        r: 0.0,
        bands: vec![0; BANDS],
        wl: vec![0; WAVE],
        wr: vec![0; WAVE],
    };

    while !stop.load(Ordering::Relaxed) && !dead.load(Ordering::Relaxed) {
        std::thread::sleep(EMIT_INTERVAL);
        let frame = {
            let mut g = match acc.lock() {
                Ok(g) => g,
                Err(_) => break,
            };
            if g.n == 0 && !g.fed {
                // Silence produces no callbacks at all on some drivers, so send
                // zeros rather than letting the needle freeze where it was.
                None
            } else {
                let n = g.n.max(1) as f64;
                let l = (g.sum[0] / n).sqrt() as f32;
                let r = (g.sum[1] / n).sqrt() as f32;
                g.sum = [0.0; 2];
                g.n = 0;
                let (bands, wl, wr) = an.run(&g);
                Some(AudioFrame { l, r, bands, wl, wr })
            }
        };
        let _ = app.emit("audio-level", frame.unwrap_or_else(|| silent.clone()));
    }
    drop(stream);
    set_status(|s| s.running = false);
    // Release the slot so a later start can try again (e.g. after the DAW quits).
    if let Ok(mut g) = slot().lock() {
        *g = None;
    }
    Ok(())
}

#[tauri::command]
pub fn audio_start(app: AppHandle) -> Result<AudioStatus, String> {
    let mut g = slot().lock().map_err(|e| e.to_string())?;
    if g.is_some() {
        return Ok(audio_status());
    }
    let stop = Arc::new(AtomicBool::new(false));
    let s2 = stop.clone();
    std::thread::spawn(move || {
        if let Err(e) = capture(app, s2) {
            eprintln!("[audio] {e}");
            set_status(|s| {
                s.running = false;
                s.error = e;
            });
        }
        // Whether it failed to open or ended, the slot must not stay occupied.
        if let Ok(mut g) = slot().lock() {
            *g = None;
        }
    });
    *g = Some(Running { stop });
    drop(g);
    // Give the thread a moment so the first status reports the real device.
    std::thread::sleep(Duration::from_millis(120));
    Ok(audio_status())
}

#[tauri::command]
pub fn audio_stop() -> Result<(), String> {
    let mut g = slot().lock().map_err(|e| e.to_string())?;
    if let Some(r) = g.take() {
        r.stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn audio_status() -> AudioStatus {
    status_slot().lock().map(|s| s.clone()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 帯の割り付けが、どのサンプリングレートでも昇順かつ Nyquist 内に収まること。
    #[test]
    fn band_edges_stay_inside_nyquist() {
        for rate in [44_100u32, 48_000, 96_000, 192_000] {
            let an = Analyzer::new(rate);
            assert_eq!(an.edges.len(), BANDS);
            let mut prev = 0usize;
            for &(lo, hi) in &an.edges {
                assert!(lo >= 1 && lo < hi, "rate={rate} lo={lo} hi={hi}");
                assert!(hi <= RING / 2, "rate={rate} hi={hi}");
                assert!(lo >= prev, "帯が逆行した rate={rate}");
                prev = lo;
            }
        }
    }

    /// 無音は全帯ゼロ、フルスケールの正弦はその帯が立つこと。
    #[test]
    fn full_scale_sine_lights_its_band() {
        let rate = 48_000u32;
        let mut an = Analyzer::new(rate);
        let mut acc = Acc::default();
        let quiet: Vec<f32> = vec![0.0; RING * 2];
        acc.feed(&quiet, 2, 1.0);
        let (bands, _, _) = an.run(&acc);
        assert!(bands.iter().all(|&b| b == 0), "無音で帯が立った");

        let f = 1000.0f32;
        let mut acc = Acc::default();
        let buf: Vec<f32> = (0..RING * 2)
            .map(|i| {
                let t = (i / 2) as f32 / rate as f32;
                (2.0 * std::f32::consts::PI * f * t).sin()
            })
            .collect();
        acc.feed(&buf, 2, 1.0);
        let (bands, wl, wr) = an.run(&acc);
        let peak = bands.iter().copied().max().unwrap_or(0);
        assert!(peak > 230, "1kHz フルスケールが {peak} にしかならない");
        let idx = bands.iter().position(|&b| b == peak).unwrap();
        let bin_hz = rate as f32 / RING as f32;
        let (lo, hi) = an.edges[idx];
        assert!(
            (lo as f32 * bin_hz) <= f && f <= (hi as f32 * bin_hz),
            "ピークの帯 {idx} ({}..{} Hz) に 1kHz が入っていない",
            lo as f32 * bin_hz,
            hi as f32 * bin_hz
        );
        assert_eq!(wl.len(), WAVE);
        assert_eq!(wr.len(), WAVE);
        assert!(wl.iter().any(|&v| v.abs() > 100), "波形が振れていない");
    }
}
