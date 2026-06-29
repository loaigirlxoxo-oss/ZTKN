using System.Text;
using System.Text.Json;
using LibreHardwareMonitor.Hardware;

// 一定間隔(既定0.5秒)で全センサー値を JSON 1行で stdout へ出力するサイドカー。
// センサー源は LibreHardwareMonitor（CPU温度・GPU・メモリ・ネット等すべてLHMで取得）。
// Tauri(Rust) が stdout を読みフロントへ転送する。第1引数=送出間隔ms(100以上、既定500)。

var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = false };
int intervalMs = args.Length > 0 && int.TryParse(args[0], out var ms) && ms >= 100 ? ms : 500;

var computer = new Computer
{
    IsCpuEnabled = true, IsGpuEnabled = true, IsMemoryEnabled = true,
    IsMotherboardEnabled = true, IsStorageEnabled = true, IsNetworkEnabled = true,
    IsControllerEnabled = true, IsBatteryEnabled = true,
};
computer.Open();
var visitor = new UpdateVisitor();

while (true)
{
    computer.Accept(visitor);
    var sensors = new List<SensorDto>();
    var used = new HashSet<string>();
    foreach (var hw in computer.Hardware) CollectLhm(hw, sensors, used);
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
        hardware.Update();
        foreach (var sub in hardware.SubHardware) sub.Accept(this);
    }
    public void VisitSensor(ISensor sensor) { }
    public void VisitParameter(IParameter parameter) { }
}
