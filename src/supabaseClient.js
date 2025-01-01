// supabaseClient.js
const { createClient } = require("@supabase/supabase-js");

// Supabase URL ve Key bilgilerini ekleyin
const supabaseUrl = "https://egpfenrpripkjpemjxtg.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY;

// Supabase client oluştur
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
