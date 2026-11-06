import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Bonanza";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background: "#0d0e0b",
        color: "#efe9d9",
      }}
    >
      <div style={{ width: 48, height: 48, background: "#f2b632", marginBottom: 40 }} />
      <div style={{ fontSize: 132, fontWeight: 900, letterSpacing: -2 }}>BONANZA</div>
      <div style={{ fontSize: 38, color: "#b1ad9c", marginTop: 16 }}>
        Every ticket is a pixel of static until the beacon lands.
      </div>
    </div>,
    size
  );
}
