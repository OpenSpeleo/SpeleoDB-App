import React, { useState } from 'react';
import { Link, useHistory } from 'react-router-dom';
import { IonPage, IonContent } from '@ionic/react';
import { useSpeleoDB } from '../context/SpeleoDBProvider';
import { PREFERENCES } from '../constants';
import { getPreferences } from '../services/PreferencesService';
import { getInstanceBaseUrl, INSTANCE_PATHS } from '../utils/url';
import logoSvg from '../assets/media/logo.png';
import authIllustrationSvg from '../assets/media/auth-illustration.svg';

const Login: React.FC = () => {
  const history = useHistory();
  const { controller } = useSpeleoDB();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [instance, setInstance] = useState<string>(() =>
    getPreferences().instance ?? PREFERENCES.DEFAULT_INSTANCE,
  );
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      const result = await controller.login({ email, password, instance });
      
      if (result.success) {
        setSuccess(result.message);
        setTimeout(() => {
          history.push('/dashboard');
        }, 1000);
      } else {
        setError(result.message);
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const instanceBase = getInstanceBaseUrl(instance);
  const signupUrl = instanceBase + INSTANCE_PATHS.SIGNUP;
  const forgotPasswordUrl = instanceBase + INSTANCE_PATHS.PASSWORD_RESET;

  return (
    <IonPage>
      <IonContent fullscreen className="ion-no-padding">
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
              <div className="py-8 pt-[calc(2rem+env(safe-area-inset-top))]">
                {/* Page header */}
                <div className="max-w-3xl mx-auto text-center pb-12">
                  {/* Logo */}
                  <div className="mb-5">
                    <Link to="/" className="flex justify-center">
                      <img className="h-20 max-w-full" src={logoSvg} alt="Logo" />
                    </Link>
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

                  <form onSubmit={handleSubmit}>
                    <div className="space-y-6">
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
                          autoComplete="email"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between">
                          <label className="block text-sm text-slate-300 font-medium mb-1" htmlFor="password">
                            Password
                          </label>
                          <a
                            href={forgotPasswordUrl}
                            target="_blank"
                            rel="noopener noreferrer"
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
                          autoComplete="url"
                        />
                      </div>
                    </div>
                    <div className="mt-6">
                      <button
                        className="w-full inline-flex items-center justify-center px-6 py-3 text-sm font-medium text-white bg-purple-500 hover:bg-purple-600 rounded-full transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed group"
                        type="submit"
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          'Signing In...'
                        ) : (
                          <>
                            Sign In 
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
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-purple-500 hover:text-purple-400 transition-colors"
                      >
                        Sign up
                      </a>
                    </p>
                  </div>

                  {/* Offline indicator */}
                  <div className="mt-8 text-center">
                    <p className="text-xs text-slate-500 flex items-center justify-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${navigator.onLine ? 'bg-green-500' : 'bg-yellow-500'}`} />
                      {navigator.onLine ? 'Online' : 'Offline - Using local authentication'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Login;
