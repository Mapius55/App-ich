// Du › Dein Körper: empty until WHOOP or Polar is connected (the connections task
// fills in Schlaf, Erholung, Belastung for 7 days later).
export function BodySection({ onConnections }: { onConnections(): void }) {
  return (
    <div className="du-body">
      <p className="du-serif">Verbinde WHOOP oder Polar, dann sehe ich, wie du schläfst und dich erholst.</p>
      <button type="button" className="pl-quiet" onClick={onConnections}>
        Zu den Verbindungen
      </button>
    </div>
  );
}
