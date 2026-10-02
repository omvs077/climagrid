import { ClimateMap } from "@/components/climate-map";

export default function Home() {
  return (
    <main className="h-screen w-screen">
      <h1 className="sr-only">ClimaGrid - Pune Urban Heat Island Map</h1>
      <ClimateMap />
    </main>
  );
}