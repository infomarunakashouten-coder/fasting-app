import { ImageResponse } from "next/og";

export const createAppIcon = (size: number) =>
  new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#5f9f9b",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            width: "78%",
            height: "78%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "28%",
            background: "#f7f4ee",
            boxShadow: "0 18px 36px rgba(42, 79, 76, 0.22)",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "58%",
              height: "58%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "47%",
                top: "18%",
                width: "8%",
                height: "68%",
                borderRadius: "999px",
                background: "#4f8d89",
                transform: "rotate(28deg)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "17%",
                top: "32%",
                width: "40%",
                height: "27%",
                borderRadius: "70% 12% 70% 12%",
                background: "#78b9a2",
                transform: "rotate(18deg)",
              }}
            />
            <div
              style={{
                position: "absolute",
                right: "12%",
                top: "15%",
                width: "39%",
                height: "27%",
                borderRadius: "12% 70% 12% 70%",
                background: "#5f9f9b",
                transform: "rotate(-10deg)",
              }}
            />
            <div
              style={{
                position: "absolute",
                right: "8%",
                bottom: "23%",
                width: "36%",
                height: "25%",
                borderRadius: "12% 70% 12% 70%",
                background: "#8bc5ad",
                transform: "rotate(12deg)",
              }}
            />
          </div>
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
    }
  );
