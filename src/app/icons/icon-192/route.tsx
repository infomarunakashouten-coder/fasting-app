import { createAppIcon } from "@/lib/app-icon";

export const runtime = "edge";

export async function GET() {
  return createAppIcon(192);
}
