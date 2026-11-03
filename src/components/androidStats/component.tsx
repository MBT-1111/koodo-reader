import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import DatabaseService from "../../utils/storage/databaseService";
import { phoneReadingStats, parseReadingDate, type PhoneReadingStats } from "../../custom/android/stats";
import "./androidStats.css";

interface StatsState { status: "loading" | "ready" | "error"; data?: PhoneReadingStats }
const AndroidStats = () => {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<StatsState>({ status: "loading" });
  const [chart, setChart] = useState<"bar" | "line">("bar");
  const generation = useRef(0);
  const locale = ({ zhCN: "zh-CN", zhTW: "zh-TW", zhMO: "zh-MO", ptBR: "pt-BR" } as Record<string, string>)[i18n.language] || i18n.language;
  const load = async () => {
    const request = ++generation.current;
    setState(previous => ({ ...previous, status: "loading" }));
    try {
      const bookKeys = await DatabaseService.getAllRecordKeys("books");
      const data = phoneReadingStats({ bookKeys, daily: ConfigService.getAllObjectConfig("readingStats"), totals: ConfigService.getAllObjectConfig("readingTime"),
        progress: ConfigService.getAllObjectConfig("recordLocation"), deleted: ConfigService.getAllListConfig("deletedBooks") || [] });
      if (request === generation.current) setState({ status: "ready", data });
    } catch { if (request === generation.current) setState({ status: "error" }); }
  };
  useEffect(() => {
    void load();
    return () => { generation.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const time = (value: number) => value >= 3600
    ? t("android.stats.hoursMinutes", { hours: Math.floor(value / 3600), minutes: Math.floor(value % 3600 / 60) })
    : t(value >= 60 ? "android.stats.minutes" : "android.stats.seconds", { count: Math.floor(value >= 60 ? value / 60 : value) });
  const dateLabel = (value: string) => parseReadingDate(value)!.toLocaleDateString(locale, { month: "numeric", day: "numeric" });
  const { data } = state;
  const chartDays = data?.week.map(day => ({ ...day, minutes: day.seconds / 60 })) || [];
  const grid = { stroke: "var(--stats-grid)", strokeDasharray: "3 3", vertical: false };
  const xAxis = <XAxis dataKey="date" tickFormatter={dateLabel} interval={0} tick={{ fontSize: 11, fill: "var(--settings-muted)" }} tickLine={false} axisLine={false} minTickGap={0} />;
  const yAxis = <YAxis width={34} tick={{ fontSize: 11, fill: "var(--settings-muted)" }} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={value => t("android.stats.minutes", { count: value })} />;
  const tooltip = <Tooltip labelFormatter={value => String(value)} formatter={(_value, _name, entry) => [time(Number(entry.payload?.seconds || 0)), t("Total reading time")]}
    contentStyle={{ background: "var(--settings-surface)", color: "var(--settings-text)", border: "1px solid var(--settings-muted)", borderRadius: 12 }} />;
  const activity = data?.activity || [];
  const padding = activity.length ? parseReadingDate(activity[0].date)!.getDay() : 0;
  const cells = [...Array<null>(padding).fill(null), ...activity];
  const columns = Array.from({ length: Math.ceil(cells.length / 7) }, (_, index) => cells.slice(index * 7, index * 7 + 7));
  const intensity = (value: number) => value <= 0 ? 0 : value < 300 ? 1 : value < 900 ? 2 : value < 1800 ? 3 : 4;
  return <section className="android-stats" aria-label={t("Reading Stats")} aria-busy={state.status === "loading"}>
    <div className="android-stats-toolbar"><button type="button" onClick={() => void load()} disabled={state.status === "loading"}>{t("Refresh")}</button></div>
    {state.status === "loading" && <p role="status">{t("Loading...")}</p>}
    {state.status === "error" && <p role="alert">{t("android.stats.failed")}</p>}
    {data && <>
      <div className="android-stats-cards">
        {[
          { key: "books", value: data.totalBooks.toLocaleString(locale), label: "Books read", icon: "bookshelf" },
          { key: "total", value: time(data.totalSeconds), label: "Total reading time", icon: "grid" },
          { key: "streak", value: data.longestStreak.toLocaleString(locale), label: "android.stats.longestStreak", icon: "chart" },
          { key: "average", value: time(data.avgDailySeconds), label: "Daily average", icon: "clock" },
        ].map(card => <div className="android-stats-card" key={card.key} data-stat={card.key}><span className={`icon-${card.icon}`} aria-hidden="true" /><strong>{card.value}</strong><span>{t(card.label)}</span></div>)}
      </div>
      {data.totalSeconds === 0 && <p className="android-stats-empty" role="status">{t("android.stats.empty")}</p>}
      <div className="android-stats-section">
        <div className="android-stats-heading"><h2>{t("android.stats.readingMinutes")}</h2><span>{t("android.stats.last7Days")}</span></div>
        <div className="android-stats-chart-tabs" role="group" aria-label={t("android.stats.chartType")}>
          {(["bar", "line"] as const).map(type => <button type="button" key={type} aria-pressed={chart === type} onClick={() => setChart(type)}>{t(type === "bar" ? "Bar Chart" : "Line Chart")}</button>)}
        </div>
        <div className="android-stats-chart" data-chart={chart} role="img" aria-label={t("android.stats.weekSummary", { value: time(data.week.reduce((sum, day) => sum + day.seconds, 0)) })}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            {chart === "bar" ? <BarChart data={chartDays} margin={{ top: 12, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid {...grid} />{xAxis}{yAxis}{tooltip}<Bar dataKey="minutes" fill="var(--settings-accent)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart> : <AreaChart data={chartDays} margin={{ top: 12, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid {...grid} />{xAxis}{yAxis}{tooltip}<Area type="monotone" dataKey="minutes" stroke="var(--settings-accent)" fill="var(--settings-tint)" strokeWidth={2} isAnimationActive={false} />
            </AreaChart>}
          </ResponsiveContainer>
        </div>
        <ul className="android-stats-day-summary">{data.week.map(day => <li key={day.date}><time dateTime={day.date}>{dateLabel(day.date)}</time><span>{time(day.seconds)}</span></li>)}</ul>
      </div>
      <div className="android-stats-section">
        <div className="android-stats-heading"><h2>{t("Reading Activity")}</h2><span>{t("android.stats.last90Days")}</span></div>
        <div className="android-stats-activity" role="img" aria-label={t("android.stats.activitySummary", { count: activity.filter(day => day.seconds > 0).length })}>
          <div className="android-stats-weekdays">{Array.from({ length: 7 }, (_, day) => <span key={day}>{[1, 3, 5].includes(day) ? new Date(2026, 10, 1 + day).toLocaleDateString(locale, { weekday: "narrow" }) : ""}</span>)}</div>
          <div className="android-stats-heatmap">{columns.map((week, index) => <div className="android-stats-week" key={index}>{week.map((day, row) => day
            ? <span className="android-stats-cell" data-level={intensity(day.seconds)} data-date={day.date} key={day.date} title={`${day.date}: ${time(day.seconds)}`} />
            : <span className="android-stats-cell android-stats-cell-padding" key={`padding-${row}`} />)}</div>)}</div>
        </div>
        <div className="android-stats-legend"><span>{t("android.stats.lessActivity")}</span>{[0, 1, 2, 3, 4].map(level => <span className="android-stats-cell" data-level={level} key={level} />)}<span>{t("android.stats.moreActivity")}</span></div>
      </div>
    </>}
  </section>;
};
export default AndroidStats;
