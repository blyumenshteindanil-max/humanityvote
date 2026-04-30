import { createClient } from '@supabase/supabase-js';

// Эти значения берутся из переменных окружения (Vercel)
// Локально для разработки можно вписать сюда напрямую,
// но для продакшена ОБЯЗАТЕЛЬНО через env vars
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials missing! Add VITE_SUPABASE_URL and VITE_SUPABASE_KEY to environment variables.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
