using System.Text;
using System.Text.Json;
using LibreHardwareMonitor.Hardware;

// 一定間隔(既定0.5秒)で全センサー値を JSON 1行で stdout へ出力するサイドカー。
// センサー源は LibreHardwareMonitor（CPU温度・GPU・メモリ・ネット等すべてLHMで取得）。
// Tauri(Rust) が stdout を読みフロントへ転送する。
// 引数: 送出間隔ms(100以上、既定500) / pc-profile.json のパス(PC全体の電力推定に使う) /
//       --memory-temps(メモリ温度を読む。SMBus を使う) / --parent <PID>(親が消えたら自分も終わる)

// Console.OpenStandardOutput() は読み手が居なくなっても書き込みエラーを黙って無視する（.NET の仕様）。
// それだと ZTKN が落ちてもこのプロセスは気づかずに残り続けるので、標準出力のハンドルを直接開き、
// 書けなくなったら IOException で終われるようにする。
var stdout = new StreamWriter(
    new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(Native.GetStdHandle(-11), ownsHandle: false), FileAccess.Write, 1),
    new UTF8Encoding(false)) { AutoFlush = false };
int intervalMs = args.Length > 0 && int.TryParse(args[0], out var ms) && ms >= 100 ? ms : 500;
string? profilePath = args.FirstOrDefault(a => a.EndsWith(".json", StringComparison.OrdinalIgnoreCase));
bool memoryTemps = args.Contains("--memory-temps");
int parentArg = Array.IndexOf(args, "--parent");
if (parentArg >= 0 && parentArg + 1 < args.Length && int.TryParse(args[parentArg + 1], out var parentPid))
    WatchParent(parentPid);

// GPU のハンドルはドライバのリセット・TDR・スリープ復帰で無効になることがあり、
// その後は Update() が成功しても値が 0 のまま返り続ける（実機で発生）。
// 復旧はこのプロセスを起動し直すことで行う（ZTKN 側の「センサー再起動」ボタン）。
//
// 自動検出はしない。「壊れている」の判定を値から推測しようとすると、
// 未使用の Wi-Fi や仮想スイッチなど平常時から全センサーが 0 のデバイス（実機で32個）を
// 誤って故障と判定し、再初期化を繰り返す。
var computer = new Computer
{
    // メモリ温度を使わないときは IsMemoryEnabled を切り、SMBus に一切触らない（OsMemory.cs の説明）。
    IsCpuEnabled = true, IsGpuEnabled = true, IsMemoryEnabled = memoryTemps,
    IsMotherboardEnabled = true, IsStorageEnabled = true, IsNetworkEnabled = true,
    IsControllerEnabled = true, IsBatteryEnabled = true,
};
computer.Open();
// マザーボードのチップ（SuperIO。ファン・電圧・温度）は、ISA バスの共有ミューテックスが取れないと
// 見つけられず、そのまま諦められる。直前まで動いていたサイドカーや他の監視ツールが持っていると、
// 起動し直しのたびに見失うことがあった（実機：メモリ温度の切り替え後に Nuvoton の 40 個が消えた）。
// 見つからなければ数秒おいて探し直す。管理者でなければそもそも読めないので探し直さない。
if (IsAdministrator())
    for (int attempt = 1; attempt <= 3 && !HasSuperIo(computer); attempt++)
    {
        Console.Error.WriteLine($"[sensor-sidecar] マザーボードのチップが見つからない。探し直す ({attempt}/3)");
        Thread.Sleep(3000);
        computer.IsMotherboardEnabled = false;
        computer.IsMotherboardEnabled = true;
    }
var visitor = new UpdateVisitor();
// NVML は先頭の NVIDIA GPU しか見ないので、NVIDIA が1枚のときだけ推定を使う。
var gpuEstimator = computer.Hardware.Count(h => h.HardwareType == HardwareType.GpuNvidia) == 1
    ? GpuPowerEstimator.TryCreate() : null;
var systemEstimator = SystemPowerEstimator.Load(profilePath);

while (true)
{
    computer.Accept(visitor);
    var sensors = new List<SensorDto>();
    var used = new HashSet<string>();
    float? dgpuW = null;   // 単体 GPU の電力（実測があれば実測、無ければ推定）。PC 全体の推定に使う
    foreach (var hw in computer.Hardware)
    {
        CollectLhm(hw, sensors, used);
        if (hw.HardwareType is HardwareType.GpuNvidia or HardwareType.GpuAmd && PowerOf(hw) is float real)
            dgpuW = (dgpuW ?? 0f) + real;
        else if (gpuEstimator != null && hw.HardwareType == HardwareType.GpuNvidia
            && gpuEstimator.Estimate(hw) is float est)
        {
            dgpuW = (dgpuW ?? 0f) + est;
            string id = $"{hw.Name}|{GpuPowerEstimator.SensorName}|Power";
            if (used.Add(id)) sensors.Add(new SensorDto(id, GpuPowerEstimator.SensorName, hw.Name, "Power", est, "W"));
        }
    }
    if (!memoryTemps)
        foreach (var (hw, name, type, value, unit) in OsMemory.Read())
        {
            string id = $"{hw}|{name}|{type}";
            if (used.Add(id)) sensors.Add(new SensorDto(id, name, hw, type, value, unit));
        }
    // PC 全体（コンセント側）の推定と内訳。内蔵 GPU は CPU Package に含まれるので足さない。
    if (systemEstimator.Estimate(computer.Hardware, dgpuW) is { } parts)
        foreach (var (name, watts) in parts)
        {
            string id = $"PC|{name}|Power";
            if (used.Add(id)) sensors.Add(new SensorDto(id, name, "PC", "Power", watts, "W"));
        }
    try
    {
        stdout.WriteLine(JsonSerializer.Serialize(new Payload("LHM", sensors)));
        stdout.Flush();
    }
    catch (IOException)
    {
        break; // 読み手（ZTKN）が居なくなった。取り残されて読み続けないよう終わる
    }
    Thread.Sleep(intervalMs);
}

// 親（ZTKN）が終了・クラッシュしたら自分も終わる。これが無いと、ZTKN を起動し直すたびに
// 取り残されたサイドカーが増え、それぞれが PawnIO を使い続けていた（実機で確認）。
static void WatchParent(int pid)
{
    try
    {
        var parent = System.Diagnostics.Process.GetProcessById(pid);
        var t = new Thread(() => { parent.WaitForExit(); Environment.Exit(0); }) { IsBackground = true };
        t.Start();
    }
    catch (ArgumentException)
    {
        Environment.Exit(0); // 起動した時点で親がもう居ない
    }
}

static bool HasSuperIo(Computer c) =>
    c.Hardware.Any(h => h.HardwareType == HardwareType.Motherboard
                        && h.SubHardware.Any(s => s.HardwareType == HardwareType.SuperIO));

static bool IsAdministrator() =>
    OperatingSystem.IsWindows()
    && new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent())
        .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);

static void CollectLhm(IHardware hw, List<SensorDto> outList, HashSet<string> usedIds)
{
    foreach (var s in hw.Sensors)
    {
        if (s.Value is float v && !float.IsNaN(v) && !float.IsInfinity(v))
        {
            // 識別子は安定な合成キー（hw|name|type）。LHM内部のIdentifierは再列挙で変わる/機種固有なので使わない。
            // 同一(hw,name,type)が複数あるときだけ #2,#3… を付けて一意化（列挙順は安定）。
            string type = s.SensorType.ToString();
            string baseId = $"{hw.Name}|{s.Name}|{type}";
            string id = baseId;
            for (int n = 2; !usedIds.Add(id); n++) id = $"{baseId}#{n}";
            outList.Add(new SensorDto(id, s.Name, hw.Name, type, v, UnitForLhm(s.SensorType)));
        }
    }
    foreach (var sub in hw.SubHardware) CollectLhm(sub, outList, usedIds);
}

// GPU の実測電力。ドライバが電力を返す GPU では推定を出さない（本物の値と二重になる）。
static float? PowerOf(IHardware hw)
{
    foreach (var s in hw.Sensors)
        if (s.SensorType == SensorType.Power && s.Name is "GPU Package" or "GPU Power"
            && s.Value is float v && float.IsFinite(v)) return v;
    return null;
}

static string UnitForLhm(SensorType t) => t switch
{
    SensorType.Temperature => "°C",
    SensorType.Load => "%",
    SensorType.Clock => "MHz",
    SensorType.Voltage => "V",
    SensorType.Fan => "RPM",
    SensorType.Power => "W",
    SensorType.Data => "GB",
    SensorType.SmallData => "MB",
    SensorType.Throughput => "B/s",
    SensorType.Frequency => "Hz",
    SensorType.Level => "%",
    SensorType.Current => "A",
    SensorType.Flow => "L/h",
    SensorType.Control => "%",
    _ => "",
};

record SensorDto(string id, string name, string hw, string type, float value, string unit);
record Payload(string source, List<SensorDto> sensors);

class UpdateVisitor : IVisitor
{
    public void VisitComputer(IComputer computer) => computer.Traverse(this);
    public void VisitHardware(IHardware hardware)
    {
        // 1つのデバイスの読み取り失敗で全センサーが止まらないようにする。
        // ドライバのリセット中などに例外が飛ぶことがあるが、他のデバイスは読めるので続行する。
        // 恒常的に読めなくなった場合は呼び出し側が検出して再初期化する。
        try { hardware.Update(); }
        catch (Exception e) { Console.Error.WriteLine($"[sensor-sidecar] {hardware.Name} の読み取りに失敗: {e.Message}"); }
        foreach (var sub in hardware.SubHardware) sub.Accept(this);
    }
    public void VisitSensor(ISensor sensor) { }
    public void VisitParameter(IParameter parameter) { }
}

static class Native
{
    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    public static extern IntPtr GetStdHandle(int nStdHandle); // -11 = STD_OUTPUT_HANDLE
}
