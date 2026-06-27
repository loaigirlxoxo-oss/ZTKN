using System.Text;
using System.Text.Json;
using LibreHardwareMonitor.Hardware;

// LibreHardwareMonitor を使い、1秒ごとに全センサー値を JSON 1行で stdout へ出力するサイドカー。
// Tauri(Rust) がこれを子プロセスとして起動し、stdout を読んでフロントへ転送する。

var computer = new Computer
{
    IsCpuEnabled = true,
    IsGpuEnabled = true,
    IsMemoryEnabled = true,
    IsMotherboardEnabled = true,
    IsStorageEnabled = true,
    IsNetworkEnabled = true,
    IsControllerEnabled = true,
    IsBatteryEnabled = true,
};
computer.Open();

var visitor = new UpdateVisitor();
var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = false };

while (true)
{
    computer.Accept(visitor); // 全ハードウェアを Update

    var sensors = new List<SensorDto>();
    foreach (var hw in computer.Hardware) Collect(hw, sensors);

    stdout.WriteLine(JsonSerializer.Serialize(new Payload(sensors)));
    stdout.Flush();
    Thread.Sleep(1000);
}

static void Collect(IHardware hw, List<SensorDto> outList)
{
    foreach (var s in hw.Sensors)
    {
        if (s.Value is float v && !float.IsNaN(v) && !float.IsInfinity(v))
        {
            outList.Add(new SensorDto(
                s.Identifier.ToString(),
                s.Name,
                hw.Name,
                s.SensorType.ToString(),
                v,
                UnitFor(s.SensorType)));
        }
    }
    foreach (var sub in hw.SubHardware) Collect(sub, outList);
}

static string UnitFor(SensorType t) => t switch
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
record Payload(List<SensorDto> sensors);

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
