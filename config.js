// Öffentliche Verbindungsdaten zur gemeinsamen Datenbank (Supabase).
// Der "anon"/"publishable" Schlüssel ist für Browser gedacht und darf öffentlich sein:
// Wer was sehen darf, regeln die Zugriffsregeln in supabase/schema.sql.
// NIEMALS den "service_role"/"secret" Schlüssel hier eintragen.
window.KS_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
};
