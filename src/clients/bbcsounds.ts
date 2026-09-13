import { PAGE_SIZE } from "../constants";

const API = "https://r9fanuyewg.execute-api.eu-west-1.amazonaws.com/prod/api/sfx/search";

export interface BBCSound {
  id: string;
  description: string;
  duration?: number; // ms
  fileSizes?: { mp3FileSize?: number };
}

export const BBCSoundsClient = {
  async search(query: string, page: number): Promise<{ sounds: BBCSound[]; count: number }> {
    const response = await fetch(API, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ criteria: { from: page * PAGE_SIZE, size: PAGE_SIZE, query } }),
    });
    if (!response.ok) throw new Error(`BBC Sound Effects search failed: HTTP ${response.status}`);
    const json = await response.json();
    return { sounds: json.results ?? [], count: json.total ?? 0 };
  },
};
