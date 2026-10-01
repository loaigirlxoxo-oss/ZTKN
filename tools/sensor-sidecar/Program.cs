using System.Text;
using System.Text.Json;
using LibreHardwareMonitor.Hardware;

// 一定間隔(既定0.5秒)で全センサー値を JSON 1行で stdout へ出力するサイドカー。
// センサー源は LibreHardwareMonitor（CPU温度・GPU・メモリ・ネット等すべてLHMで取得）。
// Tauri(Rust) が stdout を読みフロントへ転送する。
// 第1引数=送出間隔ms(100以上、既定500)、第2引数=pc-profile.json のパス(省略可。PC全体の電力推定に使う)。

var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = false };
int intervalMs = args.Length > 0 && int.TryParse(args[0], out var ms) && ms >= 100 ? ms : 500;

// GPU のハンドルはドライバのリセット・TDR・スリープ復帰で無効になることがあり、
// その後は Update() が成功しても値が 0 のまま返り続ける（実機で発生）。
// 復旧はこのプロセスを起動し直すことで行う（ZTKN 側の「センサー再起動」ボタン）。
//
// 自動検出はしない。「壊れている」の判定を値から推測しようとすると、
// 未使用の Wi-Fi や仮想スイッチなど平常時から全センサーが 0 のデバイス（実機で32個）を
// 誤って故障と判定し、再初期化を繰り返す。
var computer = new Computer
{
    IsCpuEnabled = true, IsGpuEnabled = true, IsMemoryEnabled = true,
    IsMotherboardEnabled = true, IsStorageEnabled = true, IsNetworkEnabled = true,
    IsControllerEnabled = true, IsBatteryEnabled = true,
};
computer.Open();
var visitor = new UpdateVisitor();
// NVML は先頭の NVIDIA GPU しか見ないので、NVIDIA が1枚のときだけ推定を使う。
var gpuEstimator = computer.Hardware.Count(h => h.HardwareType == HardwareType.GpuNvidia) == 1
    ? GpuPowerEstimator.TryCreate() : null;
var systemEstimator = SystemPowerEstimator.Load(args.Length > 1 ? args[1] : null);

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
    // PC 全体（コンセント側）の推定と内訳。内蔵 GPU は CPU Package に含まれるので足さない。
    if (systemEstimator.Estimate(computer.Hardware, dgpuW) is { } parts)
        foreach (var (name, watts) in parts)
        {
            string id = $"PC|{name}|Power";
            if (used.Add(id)) sensors.Add(new SensorDto(id, name, "PC", "Power", watts, "W"));
        }
    stdout.WriteLine(JsonSerializer.Serialize(new Payload("LHM", sensors)));
    stdout.Flush();
    Thread.Sleep(intervalMs);
}

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
