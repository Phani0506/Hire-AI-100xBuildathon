
import { useState, useEffect, createContext, useContext } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface SecureAuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ error: any }>;
}

const SecureAuthContext = createContext<SecureAuthContextType | undefined>(undefined);

export const useSecureAuth = () => {
  const context = useContext(SecureAuthContext);
  if (!context) {
    throw new Error('useSecureAuth must be used within a SecureAuthProvider');
  }
  return context;
};

// Input validation and sanitization utilities
const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
};

const validatePassword = (password: string): { valid: boolean; message?: string } => {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }
  if (password.length > 128) {
    return { valid: false, message: 'Password must be less than 128 characters' };
  }
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    return { valid: false, message: 'Password must contain uppercase, lowercase, and number' };
  }
  return { valid: true };
};

const sanitizeInput = (input: string): string => {
  return input.trim().slice(0, 255); // Limit input length and trim whitespace
};

// Rate limiting for authentication attempts
const authAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_AUTH_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

const checkRateLimit = (identifier: string): boolean => {
  const now = Date.now();
  const attempts = authAttempts.get(identifier);
  
  if (!attempts) return true;
  
  if (now - attempts.lastAttempt > LOCKOUT_DURATION) {
    authAttempts.delete(identifier);
    return true;
  }
  
  return attempts.count < MAX_AUTH_ATTEMPTS;
};

const recordAuthAttempt = (identifier: string, success: boolean) => {
  const now = Date.now();
  const attempts = authAttempts.get(identifier) || { count: 0, lastAttempt: 0 };
  
  if (success) {
    authAttempts.delete(identifier);
  } else {
    authAttempts.set(identifier, {
      count: attempts.count + 1,
      lastAttempt: now
    });
  }
};

export const SecureAuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);

        // Log authentication events
        if (event === 'SIGNED_IN' && session?.user) {
          await supabase.rpc('log_auth_event', {
            event_type: 'sign_in',
            user_email: session.user.email
          });
        } else if (event === 'SIGNED_OUT') {
          await supabase.rpc('log_auth_event', {
            event_type: 'sign_out',
            user_email: user?.email || null
          });
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [user?.email]);

  const signUp = async (email: string, password: string, fullName?: string) => {
    try {
      // Input validation
      const sanitizedEmail = sanitizeInput(email.toLowerCase());
      const sanitizedFullName = fullName ? sanitizeInput(fullName) : undefined;

      if (!validateEmail(sanitizedEmail)) {
        return { error: { message: 'Invalid email format' } };
      }

      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        return { error: { message: passwordValidation.message } };
      }

      // Rate limiting check
      if (!checkRateLimit(sanitizedEmail)) {
        return { error: { message: 'Too many attempts. Please try again later.' } };
      }

      const redirectUrl = `${window.location.origin}/`;
      
      const { error } = await supabase.auth.signUp({
        email: sanitizedEmail,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: sanitizedFullName
          }
        }
      });

      recordAuthAttempt(sanitizedEmail, !error);
      
      if (!error) {
        await supabase.rpc('log_auth_event', {
          event_type: 'sign_up',
          user_email: sanitizedEmail
        });
      }
      
      return { error };
    } catch (error: any) {
      return { error: { message: 'An unexpected error occurred' } };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const sanitizedEmail = sanitizeInput(email.toLowerCase());

      if (!validateEmail(sanitizedEmail)) {
        return { error: { message: 'Invalid email format' } };
      }

      if (!checkRateLimit(sanitizedEmail)) {
        return { error: { message: 'Too many attempts. Please try again later.' } };
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: sanitizedEmail,
        password
      });

      recordAuthAttempt(sanitizedEmail, !error);
      
      return { error };
    } catch (error: any) {
      return { error: { message: 'An unexpected error occurred' } };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    try {
      if (!user) {
        return { error: { message: 'User not authenticated' } };
      }

      // Validate new password
      const passwordValidation = validatePassword(newPassword);
      if (!passwordValidation.valid) {
        return { error: { message: passwordValidation.message } };
      }

      // Verify current password by attempting to sign in
      const { error: verificationError } = await supabase.auth.signInWithPassword({
        email: user.email!,
        password: currentPassword
      });

      if (verificationError) {
        return { error: { message: 'Current password is incorrect' } };
      }

      // Update password
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (!error) {
        await supabase.rpc('log_auth_event', {
          event_type: 'password_change',
          user_email: user.email
        });
      }

      return { error };
    } catch (error: any) {
      return { error: { message: 'An unexpected error occurred' } };
    }
  };

  const value = {
    user,
    session,
    loading,
    signUp,
    signIn,
    signOut,
    changePassword
  };

  return (
    <SecureAuthContext.Provider value={value}>
      {children}
    </SecureAuthContext.Provider>
  );
};
