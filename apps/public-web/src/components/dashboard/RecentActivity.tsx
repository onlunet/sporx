import { Activity, AlertCircle, CheckCircle, Clock } from "lucide-react";

export type RecentActivityItem = {
  id: string;
  type: "success" | "warning" | "info";
  message: string;
  at: string;
};

interface RecentActivityProps {
  items: RecentActivityItem[];
}

function formatTimeAgo(isoDate: string) {
  const time = new Date(isoDate).getTime();
  if (!Number.isFinite(time)) {
    return "az önce";
  }

  const diffMs = Date.now() - time;
  const diffMinutes = Math.max(0, Math.round(diffMs / 60_000));

  if (diffMinutes < 1) {
    return "şimdi";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} dk önce`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} saat önce`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} gün önce`;
}

export function RecentActivity({ items }: RecentActivityProps) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-400">Güncel aktivite verisi bulunamadı.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((activity) => (
        <div key={activity.id} className="flex items-start gap-3 rounded-xl bg-white/5 p-3">
          <div className="mt-0.5">
            {activity.type === "success" && <CheckCircle className="h-4 w-4 text-neon-green" />}
            {activity.type === "warning" && <AlertCircle className="h-4 w-4 text-neon-amber" />}
            {activity.type === "info" && <Activity className="h-4 w-4 text-neon-cyan" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-300">{activity.message}</p>
            <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
              <Clock className="h-3 w-3" />
              {formatTimeAgo(activity.at)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
