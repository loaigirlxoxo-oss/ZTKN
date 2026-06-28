using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using LibreHardwareMonitor.Hardware;

// 1秒ごとに全センサー値を JSON 1行で stdout へ出力するサイドカー。
// センサー源は優先順位: HWiNFO 共有メモリ（あれば全センサー＝Arrow Lake の CPU 温度等も取得可）
// → 無ければ LibreHardwareMonitor。Tauri(Rust) が stdout を読みフロントへ転送する。

var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = false };

// --lhm 指定時は HWiNFO を使わず LHM 経路を強制（ネイティブ取得の検証・利用に使う）
bool forceLhm = args.Contains("--lhm");

Computer? computer = null;
UpdateVisitor? visitor = null;

while (true)
{
    string source;
    List<SensorDto>? sensors = forceLhm ? null : HwInfo.TryRead();
    if (sensors != null)
    {
        source = "HWiNFO";
    }
    else
    {
        // HWiNFO が無ければ LHM（必要時に一度だけ初期化）
        if (computer == null)
        {
            computer = new Computer
            {
                IsCpuEnabled = true, IsGpuEnabled = true, IsMemoryEnabled = true,
                IsMotherboardEnabled = true, IsStorageEnabled = true, IsNetworkEnabled = true,
                IsControllerEnabled = true, IsBatteryEnabled = true,
            };
            computer.Open();
            visitor = new UpdateVisitor();
        }
        computer.Accept(visitor!);
        sensors = new List<SensorDto>();
        foreach (var hw in computer.Hardware) CollectLhm(hw, sensors);
        source = "LHM";
    }

    stdout.WriteLine(JsonSerializer.Serialize(new Payload(source, sensors)));
    stdout.Flush();
    Thread.Sleep(1000);
}

static void CollectLhm(IHardware hw, List<SensorDto> outList)
{
    foreach (var s in hw.Sensors)
    {
        if (s.Value is float v && !float.IsNaN(v) && !float.IsInfinity(v))
        {
            outList.Add(new SensorDto(s.Identifier.ToString(), s.Name, hw.Name, s.SensorType.ToString(), v, UnitForLhm(s.SensorType)));
        }
    }
    foreach (var sub in hw.SubHardware) CollectLhm(sub, outList);
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

// HWiNFO 共有メモリ "Global\HWiNFO_SENS_SM2" を読み取る。HWiNFO 未起動なら null。
static class HwInfo
{
    const string MapName = "Global\\HWiNFO_SENS_SM2";
    const uint Signature = 0x53695748; // "SiWH"

    [DllImport("kernel32.dll")] private static extern uint GetACP();

    // HWiNFO の文字列はシステムの ANSI コードページ（日本語環境なら Shift-JIS=932）。
    // CodePages プロバイダを登録し、実行環境の ACP で復号する（°C や日本語名が化けない）。
    static readonly Encoding Ansi;
    static HwInfo()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        try { Ansi = Encoding.GetEncoding((int)GetACP()); }
        catch { Ansi = Encoding.Latin1; }
    }

    public static List<SensorDto>? TryRead()
    {
        MemoryMappedFile mmf;
        try { mmf = MemoryMappedFile.OpenExisting(MapName, MemoryMappedFileRights.Read); }
        catch { return null; }
        try
        {
            using (mmf)
            using (var acc = mmf.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read))
            {
                if (acc.ReadUInt32(0) != Signature) return null;
                uint offSensor = acc.ReadUInt32(20);
                uint sizeSensor = acc.ReadUInt32(24);
                uint numSensor = acc.ReadUInt32(28);
                uint offReading = acc.ReadUInt32(32);
                uint sizeReading = acc.ReadUInt32(36);
                uint numReading = acc.ReadUInt32(40);

                var hwNames = new string[numSensor];
                for (uint i = 0; i < numSensor; i++)
                {
                    long b = offSensor + (long)i * sizeSensor;
                    hwNames[i] = ReadStr(acc, b + 136, 128); // szSensorNameUser
                }

                var list = new List<SensorDto>((int)numReading);
                for (uint i = 0; i < numReading; i++)
                {
                    long b = offReading + (long)i * sizeReading;
                    uint tReading = acc.ReadUInt32(b + 0);
                    uint sensorIndex = acc.ReadUInt32(b + 4);
                    string labelOrig = ReadStr(acc, b + 12, 128);
                    string labelUser = ReadStr(acc, b + 140, 128);
                    string unit = ReadStr(acc, b + 268, 16);
                    double value = acc.ReadDouble(b + 284);
                    if (double.IsNaN(value) || double.IsInfinity(value)) continue;
                    string hw = sensorIndex < numSensor ? hwNames[sensorIndex] : "HWiNFO";
                    string id = $"hwinfo/{hw}/{labelOrig}";
                    list.Add(new SensorDto(id, labelUser, hw, TypeName(tReading), (float)value, unit));
                }
                return list.Count > 0 ? list : null;
            }
        }
        catch { return null; }
    }

    static string ReadStr(MemoryMappedViewAccessor acc, long offset, int max)
    {
        var buf = new byte[max];
        acc.ReadArray(offset, buf, 0, max);
        int n = Array.IndexOf(buf, (byte)0);
        if (n < 0) n = max;
        return Ansi.GetString(buf, 0, n);
    }

    static string TypeName(uint t) => t switch
    {
        1 => "Temperature", 2 => "Voltage", 3 => "Fan", 4 => "Current",
        5 => "Power", 6 => "Clock", 7 => "Load", _ => "Other",
    };
}

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
