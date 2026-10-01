using System.Text.Json;
using LibreHardwareMonitor.Hardware;

// PC 全体の消費電力（コンセント側）を見積もる。
//
// 実測できるのは CPU Package だけで、GPU は推定のこともある。それ以外の部品は電力センサーを
// 持たないので、部品の種類・数と典型値から足し、最後に電源ユニットの効率で割ってコンセント側にする。
// 機種ごとに違う値（ファンの数、水冷ポンプ、LED、電源の容量と等級）は pc-profile.json から読む。
// 無ければ一般的な既定値を使う。どれも推定値で、センサー名にもそう出す。
sealed class SystemPowerEstimator
{
    readonly PcProfile _p;

    SystemPowerEstimator(PcProfile p) => _p = p;

    public static SystemPowerEstimator Load(string? path)
    {
        PcProfile p = new();
        if (!string.IsNullOrEmpty(path) && File.Exists(path))
        {
            try
            {
                p = JsonSerializer.Deserialize<PcProfile>(File.ReadAllText(path),
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true, ReadCommentHandling = JsonCommentHandling.Skip })
                    ?? new PcProfile();
            }
            catch (Exception e)
            {
                // 壊れた構成ファイルで全センサーが止まるのは避ける。既定値で続け、理由は stderr に残す。
                Console.Error.WriteLine($"[sensor-sidecar] pc-profile.json を読めない。既定値で続ける: {e.Message}");
            }
        }
        return new SystemPowerEstimator(p);
    }

    /// <summary>部品ごとの内訳とコンセント側の合計。CPU 電力が読めないときは null（合計が意味を持たない）。</summary>
    public IReadOnlyList<(string name, float watts)>? Estimate(IList<IHardware> hardware, float? dgpuWatts)
    {
        var cpu = hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Cpu);
        float? cpuW = cpu is null ? null : Find(cpu, SensorType.Power, "CPU Package");
        if (cpuW is not float cpuPower || cpuPower <= 0) return null;
        float cpuLoad = (cpu is null ? null : Find(cpu, SensorType.Load, "CPU Total")) is float l ? l / 100f : 0f;
        float cpuTemp = (cpu is null ? null : Find(cpu, SensorType.Temperature, "CPU Package")) ?? 50f;

        // CPU の電源回路（VRM）の変換ロス。効率をおよそ 90% とみる。
        float vrm = cpuPower * (1f / 0.9f - 1f);

        // メモリ。DDR5 は 1 枚あたりアイドル約 1.5W、負荷時 3〜6W。帯域は読めないので CPU 負荷で間を取る。
        float ram = _p.RamModules * (1.5f + 2.5f * Math.Clamp(cpuLoad, 0f, 1f));

        // NVMe SSD。LHM の識別子が /nvme/ のものだけ（USB の外付けは別電源のことが多いので数えない）。
        float ssd = 0f;
        foreach (var h in hardware.Where(h => h.HardwareType == HardwareType.Storage && h.Identifier.ToString().StartsWith("/nvme/")))
        {
            float act = (Find(h, SensorType.Load, "Total Activity") ?? 0f) / 100f;
            ssd += _p.SsdIdleW + (_p.SsdActiveW - _p.SsdIdleW) * Math.Clamp(act, 0f, 1f);
        }

        // ファン。回転数が読めない機種が多いので、CPU 温度からマザーボード既定の曲線を真似て回転率を出す
        // （40℃で約30%、85℃で100%）。電力は回転率のおよそ3乗。モーターの基礎分として 10% は残す。
        float duty = Math.Clamp(0.3f + 0.7f * (cpuTemp - 40f) / 45f, 0.3f, 1f);
        float fans = _p.FanCount * _p.FanRatedW * (0.1f + 0.9f * duty * duty * duty);

        float dc = cpuPower + vrm + (dgpuWatts ?? 0f) + _p.ChipsetW + ram + ssd + fans + _p.PumpW + _p.LedW + _p.OtherW;
        float eff = Efficiency(dc / Math.Max(100f, _p.PsuWatts), _p.PsuTier);
        float wall = dc / eff;

        return new List<(string, float)>
        {
            ("System Power (Estimated)", wall),
            ("System DC Power (Estimated)", dc),
            ("PSU Loss (Estimated)", wall - dc),
            ("Fans (Estimated)", fans + _p.PumpW),
            ("Memory (Estimated)", ram),
            ("SSD (Estimated)", ssd),
            ("Board (Estimated)", vrm + _p.ChipsetW + _p.OtherW + _p.LedW),
        };
    }

    // 80PLUS の基準点（115V: 20/50/100% 負荷）に、低負荷側の実測（同社 1000W 機の Cybenetics 測定で
    // 2% 負荷 73.6%）を足した曲線を線形補間する。等級ごとに 20% 点からの差を同じだけずらす。
    static float Efficiency(float load, string tier)
    {
        float at20 = tier.ToLowerInvariant() switch
        {
            "bronze" => 0.82f, "silver" => 0.85f, "platinum" => 0.90f, "titanium" => 0.92f, _ => 0.87f, // gold
        };
        (float x, float y)[] pts =
        {
            (0.02f, at20 - 0.134f), (0.10f, at20 - 0.02f), (0.20f, at20), (0.50f, at20 + 0.03f), (1.00f, at20),
        };
        if (load <= pts[0].x) return pts[0].y;
        for (int i = 1; i < pts.Length; i++)
            if (load <= pts[i].x)
            {
                float t = (load - pts[i - 1].x) / (pts[i].x - pts[i - 1].x);
                return pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
            }
        return pts[^1].y;
    }

    static float? Find(IHardware hw, SensorType type, string name)
    {
        foreach (var s in hw.Sensors)
            if (s.SensorType == type && s.Name == name && s.Value is float v && float.IsFinite(v)) return v;
        return null;
    }
}

/// <summary>pc-profile.json。書かれていない項目は既定値（一般的な自作 PC）を使う。</summary>
sealed class PcProfile
{
    public float PsuWatts { get; set; } = 850f;     // 電源ユニットの定格容量
    public string PsuTier { get; set; } = "gold";   // 80PLUS の等級 bronze/silver/gold/platinum/titanium
    public int FanCount { get; set; } = 3;          // ケース・CPU クーラーのファンの合計（GPU と電源のファンは除く）
    public float FanRatedW { get; set; } = 2.0f;    // ファン 1 個の定格消費電力
    public float PumpW { get; set; } = 0f;          // 水冷ポンプ（空冷なら 0）
    public float LedW { get; set; } = 0f;           // LED の合計
    public int RamModules { get; set; } = 2;        // メモリの枚数
    public float SsdIdleW { get; set; } = 1.0f;     // NVMe SSD 1 台のアイドル電力
    public float SsdActiveW { get; set; } = 3.0f;   // NVMe SSD 1 台の読み書き中の電力
    public float ChipsetW { get; set; } = 6f;       // チップセット（Intel Z890 の Chipset Base Power）
    public float OtherW { get; set; } = 5f;         // LAN・Wi-Fi・音声・USB などの基板部品（根拠なしの仮置き）
}
