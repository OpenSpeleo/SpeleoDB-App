import React, { useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useSpeleoDB } from '../context/useSpeleoDB';
import { useMountedRef } from '../hooks/useMountedRef';
import { PREFERENCES } from '../constants';
import { getPreferences } from '../services/PreferencesService';
import { getInstanceBaseUrl, INSTANCE_PATHS, openExternalUrl } from '../utils/url';
import logoSvg from '../assets/media/logo.png';
import authIllustrationSvg from '../assets/media/auth-illustration.svg';

type LoginMethod = 'password' | 'token';

const Login: React.FC = () => {
  const history = useHistory();
  const { controller } = useSpeleoDB();
  const mountedRef = useMountedRef();
  const passwordTabRef = useRef<HTMLButtonElement>(null);
  const tokenTabRef = useRef<HTMLButtonElement>(null);
  const submissionInFlightRef = useRef(false);
  const redirectTimerRef = useRef<number | null>(null);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [instance, setInstance] = useState<string>(() =>
    getPreferences().instance ?? PREFERENCES.DEFAULT_INSTANCE,
  );
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => () => {
    if (redirectTimerRef.current !== null) {
      window.clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    setError('');
    setSuccess('');
    setIsLoading(true);
    let keepAdmissionClosed = false;

    try {
      const result = loginMethod === 'password'
        ? await controller.login({ email, password, instance })
        : await controller.loginWithToken({ token, instance });

      if (!mountedRef.current) return;
      if (result.success) {
        keepAdmissionClosed = true;
        setSuccess(result.message);
        redirectTimerRef.current = window.setTimeout(() => {
          redirectTimerRef.current = null;
          if (!mountedRef.current) return;
          history.push('/dashboard');
        }, 1000);
      } else {
        setError(result.message);
      }
    } catch {
      if (mountedRef.current) {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      if (!keepAdmissionClosed) {
        submissionInFlightRef.current = false;
        if (mountedRef.current) setIsLoading(false);
      }
    }
  };

  const selectLoginMethod = (method: LoginMethod) => {
    if (isLoading || method === loginMethod) return;
    setLoginMethod(method);
    setError('');
    setSuccess('');
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    method: LoginMethod,
  ) => {
    let nextMethod: LoginMethod | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextMethod = method === 'password' ? 'token' : 'password';
    } else if (event.key === 'Home') {
      nextMethod = 'password';
    } else if (event.key === 'End') {
      nextMethod = 'token';
    }
    if (!nextMethod) return;

    event.preventDefault();
    selectLoginMethod(nextMethod);
    (nextMethod === 'password' ? passwordTabRef : tokenTabRef).current?.focus();
  };

  let instanceBase: string = PREFERENCES.DEFAULT_INSTANCE;
  try {
    instanceBase = getInstanceBaseUrl(instance);
  } catch {
    // Keep external account links safe and renderable while the user is still
    // typing an incomplete or invalid instance URL.
  }
  const signupUrl = instanceBase + INSTANCE_PATHS.SIGNUP;
  const forgotPasswordUrl = instanceBase + INSTANCE_PATHS.PASSWORD_RESET;

  return (
    <div className="font-sans antialiased bg-slate-900 text-slate-100 tracking-tight min-h-screen flex flex-col justify-center">
      <section className="relative w-full">
        {/* Illustration */}
        <div
          className="absolute left-1/2 -translate-x-1/2 -mt-36 blur-2xl opacity-70 pointer-events-none -z-10"
          aria-hidden="true"
        >
          <img src={authIllustrationSvg} className="max-w-none" width="1440" height="450" alt="" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          <div className="py-8 pt-[calc(2rem_+_var(--safe-area-inset-top,env(safe-area-inset-top)))]">
            {/* Page header */}
            <div className="max-w-3xl mx-auto text-center pb-12">
              {/* Logo */}
              <div className="mb-5 flex justify-center">
                <img className="h-20 max-w-full" src={logoSvg} alt="SpeleoDB" />
              </div>
              {/* Page title */}
              <h1 className="pt-8 text-2xl md:text-3xl font-bold bg-gradient-to-r from-slate-200/60 via-slate-200 to-slate-200/60 bg-clip-text text-transparent">
                Sign in to your account
              </h1>
            </div>

            {/* Form */}
            <div className="max-w-sm mx-auto">
              {/* Error message */}
              {error && (
                <div className="mb-4 p-3 rounded-2xl border-2 border-red-500 text-center text-sm text-slate-300 font-medium">
                  {error}
                </div>
              )}

              {/* Success message */}
              {success && (
                <div className="mb-4 p-3 rounded-2xl border-2 border-green-500 text-center text-sm text-slate-300 font-medium">
                  {success}
                </div>
              )}

              <div
                className="mb-6 grid grid-cols-2 gap-2"
                role="tablist"
                aria-label="Sign-in method"
              >
                <button
                  ref={passwordTabRef}
                  id="password-login-tab"
                  className={`app-btn app-btn--compact ${
                    loginMethod === 'password' ? 'app-btn--primary' : 'app-btn--secondary'
                  }`}
                  type="button"
                  role="tab"
                  aria-selected={loginMethod === 'password'}
                  aria-controls="password-login-panel"
                  tabIndex={loginMethod === 'password' ? 0 : -1}
                  disabled={isLoading}
                  onClick={() => selectLoginMethod('password')}
                  onKeyDown={(event) => handleTabKeyDown(event, 'password')}
                >
                  Email &amp; Password
                </button>
                <button
                  ref={tokenTabRef}
                  id="token-login-tab"
                  className={`app-btn app-btn--compact ${
                    loginMethod === 'token' ? 'app-btn--primary' : 'app-btn--secondary'
                  }`}
                  type="button"
                  role="tab"
                  aria-selected={loginMethod === 'token'}
                  aria-controls="token-login-panel"
                  tabIndex={loginMethod === 'token' ? 0 : -1}
                  disabled={isLoading}
                  onClick={() => selectLoginMethod('token')}
                  onKeyDown={(event) => handleTabKeyDown(event, 'token')}
                >
                  OAuth Token
                </button>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="space-y-6">
                  {loginMethod === 'password' ? (
                    <div
                      id="password-login-panel"
                      className="space-y-6"
                      role="tabpanel"
                      aria-labelledby="password-login-tab"
                    >
                      <div>
                        <label className="block text-sm text-slate-300 font-medium mb-1" htmlFor="email">
                          Email
                        </label>
                        <input
                          id="email"
                          name="email"
                          className="w-full px-4 py-2.5 text-sm text-slate-300 bg-transparent border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors placeholder:text-slate-500"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          autoComplete="username"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between">
                          <label className="block text-sm text-slate-300 font-medium mb-1" htmlFor="password">
                            Password
                          </label>
                          <a
                            href={forgotPasswordUrl}
                            onClick={(e) => {
                              e.preventDefault();
                              openExternalUrl(forgotPasswordUrl);
                            }}
                            className="text-sm font-medium text-purple-500 hover:text-purple-400 transition-colors"
                          >
                            Forgot?
                          </a>
                        </div>
                        <input
                          id="password"
                          name="password"
                          className="w-full px-4 py-2.5 text-sm text-slate-300 bg-transparent border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors placeholder:text-slate-500"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          autoComplete="current-password"
                        />
                      </div>
                    </div>
                  ) : (
                    <div
                      id="token-login-panel"
                      role="tabpanel"
                      aria-labelledby="token-login-tab"
                    >
                      <label className="block text-sm text-slate-300 font-medium mb-1" htmlFor="oauth-token">
                        OAuth token
                      </label>
                      <input
                        id="oauth-token"
                        name="oauth-token"
                        className="w-full px-4 py-2.5 text-sm text-slate-300 bg-transparent border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors placeholder:text-slate-500"
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        required
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                    </div>
                  )}
                  <div className="pt-2">
                    <label className="block text-sm text-slate-300 font-medium mb-1" htmlFor="instance">
                      SpeleoDB instance
                    </label>
                    <input
                      id="instance"
                      name="instance"
                      className="w-full px-4 py-2.5 text-sm text-slate-300 bg-transparent border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors placeholder:text-slate-500"
                      type="url"
                      value={instance}
                      onChange={(e) => setInstance(e.target.value)}
                      placeholder={PREFERENCES.DEFAULT_INSTANCE}
                      required
                      autoComplete="url"
                    />
                    {loginMethod === 'password' ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Native password autofill uses credentials saved for www.speleodb.org.
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        Token sign-in requires a connection so the token can be verified.
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-6">
                  <button
                    className="app-btn app-btn--primary w-full shadow-sm group"
                    type="submit"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      loginMethod === 'token' ? 'Validating Token...' : 'Signing In...'
                    ) : (
                      <>
                        {loginMethod === 'token' ? 'Sign In with Token' : 'Sign In'}{' '}
                        <span className="ml-1 text-purple-300 group-hover:translate-x-0.5 transition-transform duration-150">→</span>
                      </>
                    )}
                  </button>
                </div>
              </form>

              <div className="text-center mt-6">
                <p className="text-sm text-slate-400">
                  Don't have an account?{' '}
                  <a
                    href={signupUrl}
                    onClick={(e) => {
                      e.preventDefault();
                      openExternalUrl(signupUrl);
                    }}
                    className="font-medium text-purple-500 hover:text-purple-400 transition-colors"
                  >
                    Sign up
                  </a>
                </p>
              </div>

              {/* Offline session note */}
              {loginMethod === 'password' && (
                <div className="mt-8 text-center">
                  <p className="text-xs text-slate-500">
                    Offline access requires a previously validated secure session.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Login;
