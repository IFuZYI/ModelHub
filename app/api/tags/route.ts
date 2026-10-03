import { NextResponse } from "next/server";
import { withErrorHandling, blogService } from "@/lib";

export const dynamic = "force-dynamic";

// Public tag vocabulary with usage counts (blog taxonomy).
export const GET = withErrorHandling(async () => {
  return NextResponse.json({ tags: await blogService.listTags() });
});
