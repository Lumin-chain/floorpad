import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Floorpad",
    short_name: "Floorpad",
    description: "Meme launches with a floor that only goes up.",
    start_url: "/",
    display: "standalone",
    background_color: "#F9FAFB",
    theme_color: "#2563EB",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
