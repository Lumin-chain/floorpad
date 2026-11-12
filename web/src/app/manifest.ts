import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Floorpad",
    short_name: "Floorpad",
    description: "Meme launches with a floor that only goes up.",
    start_url: "/",
    display: "standalone",
    background_color: "#0F3B2C",
    theme_color: "#0F3B2C",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
