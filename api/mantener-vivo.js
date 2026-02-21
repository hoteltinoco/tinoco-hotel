module.exports = async function handler(req, res) {
  var SUPABASE_URL = "https://mnaslqlkzavcmkipwalv.supabase.co";
  var SUPABASE_KEY = "sb_publishable_mxifxqVbzIw1LSzSDXUXkA_SZQigrOZ";

  try {
    var response = await fetch(
      SUPABASE_URL + "/rest/v1/users?select=id&limit=1",
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: "Bearer " + SUPABASE_KEY,
        },
      }
    );

    if (response.ok) {
      return res.status(200).json({ status: "ok" });
    } else {
      return res.status(502).json({ status: "error" });
    }
  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};


5. Haz commit

6. **En cron-job.org**, cambia la URL al nombre real del archivo. Si el archivo se llama `keep-alive.js`:

   https://tinoco-hotel.vercel.app/api/keep-alive
