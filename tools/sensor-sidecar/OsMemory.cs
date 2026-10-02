using System.Runtime.InteropServices;

// メモリの使用量を OS から直接取る。
//
// LHM の IsMemoryEnabled は、管理者権限ではメモリモジュール（DIMM）を SMBus 経由で読みにいく。
// SMBus は RGB 制御ソフトなどと取り合うと詰まることがあり、ドライバ（PawnIO）の中で止まった
// プロセスは強制終了もできなくなる（別PCで実際に固まった）。メモリ温度を使わない設定では
// IsMemoryEnabled を切り、使用量だけをここで出す。センサーの識別子は LHM と同じにするので、
// 保存済みのパネルはそのまま動く（"Total Memory|Memory|Load" など）。
static class OsMemory
{
    [StructLayout(LayoutKind.Sequential)]
    struct MemoryStatusEx
    {
        public uint Length, MemoryLoad;
        public ulong TotalPhys, AvailPhys, TotalPageFile, AvailPageFile, TotalVirtual, AvailVirtual, AvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx m);

    const double GiB = 1024d * 1024 * 1024;

    /// <summary>LHM の "Total Memory" と "Virtual Memory" と同じ並び・単位のセンサー。</summary>
    public static IEnumerable<(string hw, string name, string type, float value, string unit)> Read()
    {
        var m = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
        if (!GlobalMemoryStatusEx(ref m) || m.TotalPhys == 0) yield break;
        foreach (var (hw, total, avail) in new[]
                 {
                     ("Total Memory", m.TotalPhys, m.AvailPhys),        // 物理メモリ
                     ("Virtual Memory", m.TotalPageFile, m.AvailPageFile), // コミット（物理＋ページファイル）
                 })
        {
            if (total == 0) continue;
            ulong used = total - avail;
            yield return (hw, "Memory Used", "Data", (float)(used / GiB), "GB");
            yield return (hw, "Memory Available", "Data", (float)(avail / GiB), "GB");
            yield return (hw, "Memory", "Load", (float)(100d * used / total), "%");
        }
    }
}
