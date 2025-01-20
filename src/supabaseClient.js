// supabaseClient.js
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://xrnmlxhfgmbptrktusfj.supabase.co";

const supabaseKey = process.env.SUPABASE_KEY;

// Supabase client oluştur
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
