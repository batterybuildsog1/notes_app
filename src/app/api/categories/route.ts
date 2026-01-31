import { NextResponse } from "next/server";
import { getCategories } from "@/lib/db";

const DEFAULT_USER_ID = "default-user";

export async function GET() {
  try {
    const categories = await getCategories(DEFAULT_USER_ID);
    return NextResponse.json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    return NextResponse.json(
      { error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}
