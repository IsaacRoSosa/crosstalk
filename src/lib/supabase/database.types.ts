// Generated from the Supabase schema (supabase/migrations). Regenerate after schema changes.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.18'
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: number
          nucleus_id: number
          role: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: never
          nucleus_id: number
          role: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: never
          nucleus_id?: number
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: 'chat_messages_nucleus_id_fkey'
            columns: ['nucleus_id']
            isOneToOne: false
            referencedRelation: 'nuclei'
            referencedColumns: ['id']
          },
        ]
      }
      nuclei: {
        Row: {
          created_at: string
          dominant_emotion: string | null
          id: number
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dominant_emotion?: string | null
          id?: never
          name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dominant_emotion?: string | null
          id?: never
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nucleus_tracks: {
        Row: {
          added_at: string
          nucleus_id: number
          track_id: number
        }
        Insert: {
          added_at?: string
          nucleus_id: number
          track_id: number
        }
        Update: {
          added_at?: string
          nucleus_id?: number
          track_id?: number
        }
        Relationships: [
          {
            foreignKeyName: 'nucleus_tracks_nucleus_id_fkey'
            columns: ['nucleus_id']
            isOneToOne: false
            referencedRelation: 'nuclei'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'nucleus_tracks_track_id_fkey'
            columns: ['track_id']
            isOneToOne: false
            referencedRelation: 'tracks'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tracks: {
        Row: {
          album: string | null
          analysis_model: string | null
          analyzed_at: string | null
          artist: string
          cover_url: string | null
          created_at: string
          deezer_id: number | null
          duration_ms: number | null
          emotion: string | null
          energy: number | null
          genius_url: string | null
          genre: string | null
          id: number
          isrc: string | null
          lyrical_style: string | null
          mood_description: string | null
          spotify_id: string | null
          title: string
          valence: number | null
          youtube_video_id: string | null
        }
        Insert: {
          album?: string | null
          analysis_model?: string | null
          analyzed_at?: string | null
          artist: string
          cover_url?: string | null
          created_at?: string
          deezer_id?: number | null
          duration_ms?: number | null
          emotion?: string | null
          energy?: number | null
          genius_url?: string | null
          genre?: string | null
          id?: never
          isrc?: string | null
          lyrical_style?: string | null
          mood_description?: string | null
          spotify_id?: string | null
          title: string
          valence?: number | null
          youtube_video_id?: string | null
        }
        Update: {
          album?: string | null
          analysis_model?: string | null
          analyzed_at?: string | null
          artist?: string
          cover_url?: string | null
          created_at?: string
          deezer_id?: number | null
          duration_ms?: number | null
          emotion?: string | null
          energy?: number | null
          genius_url?: string | null
          genre?: string | null
          id?: never
          isrc?: string | null
          lyrical_style?: string | null
          mood_description?: string | null
          spotify_id?: string | null
          title?: string
          valence?: number | null
          youtube_video_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type TrackRow = Database['public']['Tables']['tracks']['Row']
export type TrackInsert = Database['public']['Tables']['tracks']['Insert']
export type NucleusRow = Database['public']['Tables']['nuclei']['Row']
export type ChatMessageRow = Database['public']['Tables']['chat_messages']['Row']
