import { createClient } from '@supabase/supabase-js';

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; display_name: string | null; created_at: string; updated_at: string };
        Insert: { id: string; display_name?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; display_name?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      portfolios: {
        Row: { id: string; user_id: string; name: string; base_currency: string; created_at: string; updated_at: string };
        Insert: { id?: string; user_id: string; name?: string; base_currency?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; user_id?: string; name?: string; base_currency?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      portfolio_positions: {
        Row: { id: string; portfolio_id: string; coin_id: string; quantity: number; average_cost: number; currency: string; updated_at: string };
        Insert: { id?: string; portfolio_id: string; coin_id: string; quantity: number; average_cost: number; currency: string; updated_at?: string };
        Update: { id?: string; portfolio_id?: string; coin_id?: string; quantity?: number; average_cost?: number; currency?: string; updated_at?: string };
        Relationships: [];
      };
      watchlist_items: {
        Row: { id: string; user_id: string; coin_id: string; created_at: string };
        Insert: { id?: string; user_id: string; coin_id: string; created_at?: string };
        Update: { id?: string; user_id?: string; coin_id?: string; created_at?: string };
        Relationships: [];
      };
      price_alerts: {
        Row: { id: string; user_id: string; coin_id: string; condition: string; threshold: number; currency: string; created_at: string; triggered_at: string | null };
        Insert: { id?: string; user_id: string; coin_id: string; condition: string; threshold: number; currency: string; created_at?: string; triggered_at?: string | null };
        Update: { id?: string; user_id?: string; coin_id?: string; condition?: string; threshold?: number; currency?: string; created_at?: string; triggered_at?: string | null };
        Relationships: [];
      };
      ai_analysis_history: {
        Row: { id: string; user_id: string; coin_id: string; coin_name: string; coin_symbol: string; currency: string; price: number; analysis: Json; created_at: string };
        Insert: { id?: string; user_id: string; coin_id: string; coin_name: string; coin_symbol: string; currency: string; price: number; analysis: Json; created_at?: string };
        Update: { id?: string; user_id?: string; coin_id?: string; coin_name?: string; coin_symbol?: string; currency?: string; price?: number; analysis?: Json; created_at?: string };
        Relationships: [];
      };
      position_history: {
        Row: { id: string; user_id: string; coin_id: string; action: string; quantity: number; average_cost: number; currency: string; created_at: string };
        Insert: { id?: string; user_id: string; coin_id: string; action: string; quantity: number; average_cost: number; currency: string; created_at?: string };
        Update: { id?: string; user_id?: string; coin_id?: string; action?: string; quantity?: number; average_cost?: number; currency?: string; created_at?: string };
        Relationships: [];
      };
      paper_futures_accounts: {
        Row: { id: string; user_id: string; balance: number; realized_pnl: number; positions: Json; orders: Json; trades: Json; updated_at: string };
        Insert: { id?: string; user_id: string; balance: number; realized_pnl?: number; positions: Json; orders?: Json; trades: Json; updated_at?: string };
        Update: { id?: string; user_id?: string; balance?: number; realized_pnl?: number; positions?: Json; orders?: Json; trades?: Json; updated_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  : null;
