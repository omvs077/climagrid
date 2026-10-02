import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-center">
      <img
        src="/sprites/_curated/character_2.png"
        alt="Lost city mascot"
        width={64}
        height={64}
        style={{ imageRendering: "pixelated" }}
      />
      <div className="border-4 border-black bg-card p-6 text-card-foreground shadow-2xl">
        <h1 className="mb-3 text-sm leading-relaxed" style={{ fontFamily: "var(--font-pixel)" }}>
          404 - LOST IN THE HEAT
        </h1>
        <p className="mb-4 max-w-xs text-xs text-muted-foreground">
          This spot isn&apos;t on the map. Let&apos;s get you back to cooler ground.
        </p>
        <Link
          href="/"
          className="inline-block border-2 border-accent bg-muted px-3 py-2 text-xs text-card-foreground hover:bg-accent/20"
          style={{ fontFamily: "var(--font-pixel)" }}
        >
          BACK TO THE MAP
        </Link>
      </div>
    </div>
  );
}