using System.Runtime.InteropServices;
using LibreHardwareMonitor.Hardware;

// GPU の消費電力を、ドライバが電力を返さないときに推定する。
//
// 実機（Gainward RTX 5080 Phantom / ドライバ 591.86）では、NVML の瞬時電力・積算エネルギー、
// NVAPI の電力トポロジ、nvidia-smi、HWiNFO のどれも消費電力を返さなかった。温度・負荷・クロック・
// 電圧は読める。そこで CMOS の動的電力 P ∝ V²·f·稼働率 の形で見積もる：
//
//   P ≈ Idle + (Limit − Idle) × 負荷率 × (V / Vref)² × (f / fmax)
//
// Limit と fmax は NVML から読む（このカードでは 360W / 3090MHz）。カードごとの決め打ちはしない。
// 本物の電力センサーがあるときは使わない（呼び出し側で判定）。あくまで推定値で、名前にもそう出す。
sealed class GpuPowerEstimator
{
    public const string SensorName = "GPU Power (Estimated)";

    // アイドル時の電力。RTX 5080 のレビュー実測が 12.75〜18W（GamersNexus / Igor's Lab / TechPowerUp）なので中間を取る。
    const float IdleW = 15f;
    // 基準電圧の下限。最大負荷時のコア電圧はこれ以上になるので、観測した最大値で上書きしていく。
    const float VoltRefFloor = 1.05f;

    readonly float _limitW;
    readonly float _maxClockMHz;
    float _voltRef = VoltRefFloor;

    GpuPowerEstimator(float limitW, float maxClockMHz)
    {
        _limitW = limitW;
        _maxClockMHz = maxClockMHz;
    }

    /// <summary>NVIDIA の NVML が使えて、上限電力と最大クロックが取れるときだけ作る。</summary>
    public static GpuPowerEstimator? TryCreate()
    {
        try
        {
            if (Nvml.nvmlInit_v2() != 0) return null;
            if (Nvml.nvmlDeviceGetHandleByIndex_v2(0, out var h) != 0) return null;
            if (Nvml.nvmlDeviceGetPowerManagementLimit(h, out var mW) != 0 || mW == 0) return null;
            if (Nvml.nvmlDeviceGetMaxClockInfo(h, 0 /* graphics */, out var mhz) != 0 || mhz == 0) return null;
            return new GpuPowerEstimator(mW / 1000f, mhz);
        }
        catch (DllNotFoundException) { return null; }      // NVIDIA のドライバが無い
        catch (EntryPointNotFoundException) { return null; }
    }

    /// <summary>LHM の NVIDIA デバイスから負荷・クロック・電圧を読んで推定する。揃わなければ null。</summary>
    public float? Estimate(IHardware gpu)
    {
        float? load = Find(gpu, SensorType.Load, "GPU Core");
        float? clock = Find(gpu, SensorType.Clock, "GPU Core");
        float? volt = Find(gpu, SensorType.Voltage, "GPU Core Voltage");
        if (load is not float u || clock is not float f || volt is not float v || v <= 0) return null;
        if (v > _voltRef) _voltRef = v;
        float util = Math.Clamp(u / 100f, 0f, 1f);
        float fr = Math.Clamp(f / _maxClockMHz, 0f, 1f);
        float vr = v / _voltRef;
        float p = IdleW + (_limitW - IdleW) * util * vr * vr * fr;
        return Math.Clamp(p, 0f, _limitW);
    }

    static float? Find(IHardware hw, SensorType type, string name)
    {
        foreach (var s in hw.Sensors)
            if (s.SensorType == type && s.Name == name && s.Value is float v && float.IsFinite(v)) return v;
        return null;
    }

    static class Nvml
    {
        const string Dll = "nvml.dll";
        [DllImport(Dll)] public static extern int nvmlInit_v2();
        [DllImport(Dll)] public static extern int nvmlDeviceGetHandleByIndex_v2(uint index, out IntPtr device);
        [DllImport(Dll)] public static extern int nvmlDeviceGetPowerManagementLimit(IntPtr device, out uint milliwatts);
        [DllImport(Dll)] public static extern int nvmlDeviceGetMaxClockInfo(IntPtr device, int clockType, out uint mhz);
    }
}
