import type { Metadata } from "next";
import { Geist, Geist_Mono, Press_Start_2P } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const pressStart2P = Press_Start_2P({
  variable: "--font-pixel",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "ClimaGrid - Pune Urban Heat Island Map",
  description:
    "An interactive urban heat island map for Pune, India - explore temperature, vegetation, and built-up density, then simulate cooling interventions like trees and cool roofs.",
  keywords: ["urban heat island", "Pune", "climate map", "land surface temperature", "urban heat"],
  openGraph: {
    title: "ClimaGrid - Pune Urban Heat Island Map",
    description: "Explore Pune\u0027s urban heat island and simulate cooling interventions.",
    type: "website",
  },
  // TODO: set metadataBase to the real production URL once deployed (Phase 3),
  // e.g. metadataBase: new URL("https://climagrid.example.com"),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${pressStart2P.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
