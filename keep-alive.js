const SUPABASE_URL = "https://mnaslqlkzavcmkipwalv.supabase.co";
const SUPABASE_KEY = "sb_publishable_mxifxqVbzIw1LSzSDXUXkA_SZQigrOZ";

export default async function handler(req, res) {
  try {
    const response = await fetch(
      SUPABASE_URL + "/rest/v1/users?select=id&limit=1",
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: "Bearer " + SUPABASE_KEY,
        },
      }
    );

    if (response.ok) {
      return res.status(200).json({
        status: "ok",
        message: "Supabase esta activo",
        timestamp: new Date().toISOString(),
      });
    } else {
      return res.status(502).json({
        status: "error",
        message: "Supabase respondio con error: " + response.status,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
