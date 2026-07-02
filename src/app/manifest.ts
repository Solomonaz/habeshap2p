import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_DESCRIPTION } from "@/lib/site";

/** Web app manifest — enables "Add to home screen" and a themed PWA shell. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — USDT / ETB Exchange`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#0b0e11",
    theme_color: "#0b0e11",
    icons: [
      { src: "/logo.png", sizes: "any", type: "image/png", purpose: "any" },
    ],
  };
}
