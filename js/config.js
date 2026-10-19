// Supabase project for groups & leaderboards. The anon key is public by design;
// access is enforced by row level security (see supabase/schema.sql).
// Leave empty to run Stride fully offline without friends features.
window.STRIDE_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
