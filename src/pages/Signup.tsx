import React, { useState } from 'react';
import { Link, useHistory } from 'react-router-dom';
import { IonPage, IonContent } from '@ionic/react';
import { authService } from '../services/AuthService';
import logoSvg from '../assets/media/logo.png';
import authIllustrationSvg from '../assets/media/auth-illustration.svg';

// List of countries
const COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'MX', name: 'Mexico' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'AU', name: 'Australia' },
  { code: 'BR', name: 'Brazil' },
  { code: 'JP', name: 'Japan' },
  { code: 'CN', name: 'China' },
  { code: 'IN', name: 'India' },
  { code: 'RU', name: 'Russia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'PE', name: 'Peru' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'AT', name: 'Austria' },
  { code: 'BE', name: 'Belgium' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'PL', name: 'Poland' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'HU', name: 'Hungary' },
  { code: 'PT', name: 'Portugal' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'FI', name: 'Finland' },
  { code: 'DK', name: 'Denmark' },
  { code: 'IE', name: 'Ireland' },
  { code: 'GR', name: 'Greece' },
  { code: 'HR', name: 'Croatia' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'RO', name: 'Romania' },
  { code: 'BG', name: 'Bulgaria' },
].sort((a, b) => a.name.localeCompare(b.name));

const Signup: React.FC = () => {
  const history = useHistory();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    country: '',
    password: '',
    password2: '',
    caveMarker: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validate cave marker (anti-robot check)
    if (formData.caveMarker.trim().toUpperCase() !== 'ARROW') {
      setShowModal(true);
      return;
    }

    // Validate passwords match
    if (formData.password !== formData.password2) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);

    try {
      const result = await authService.signup({
        name: formData.name,
        email: formData.email,
        password: formData.password,
        country: formData.country,
      });

      if (result.success) {
        setSuccess(result.message);
        setTimeout(() => {
          history.push('/login');
        }, 2000);
      } else {
        setError(result.message);
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const inputClassName = "w-full px-4 py-2.5 text-sm text-slate-300 bg-transparent border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors placeholder:text-slate-500";

  return (
    <IonPage>
      <IonContent fullscreen className="ion-no-padding">
        <div className="font-sans antialiased bg-slate-900 text-slate-100 tracking-tight min-h-screen">
          <section className="relative">
            {/* Illustration */}
            <div 
              className="absolute left-1/2 -translate-x-1/2 -mt-36 blur-2xl opacity-70 pointer-events-none -z-10" 
              aria-hidden="true"
            >
              <img src={authIllustrationSvg} className="max-w-none" width="1440" height="450" alt="" />
            </div>

            <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
              <div className="pt-28 pb-8 pt-[calc(1.75rem+env(safe-area-inset-top))]">
                {/* Page header */}
                <div className="max-w-3xl mx-auto text-center pb-12">
                  {/* Logo */}
                  <div className="mb-5">
                    <Link to="/" className="inline-flex">
                      <img className="h-20" src={logoSvg} alt="Logo" />
                    </Link>
                  </div>
                  {/* Page title */}
                  <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-slate-200/60 via-slate-200 to-slate-200/60 bg-clip-text text-transparent">
                    Create a new account
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
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm text-slate-300 font-medium mb-1" htmlFor="name">
                          Full Name <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="name"
                          name="name"
                          className={inputClassName}
                          type="text"
                          placeholder="Sheck Exley"
                          value={formData.name}
                          onChange={handleChange}
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm text-slate-300 font-medium mb-1" htmlFor="email">
                          Email <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="email"
                          name="email"
                          className={inputClassName}
                          type="email"
                          placeholder="sheck@exley.com"
                          value={formData.email}
                          onChange={handleChange}
                          required
                          autoComplete="email"
                        />
                      </div>

                      <div>
                        <label className="block text-sm text-slate-300 font-medium mb-1" htmlFor="country">
                          Country <span className="text-rose-500">*</span>
                        </label>
                        <select
                          id="country"
                          name="country"
                          className={inputClassName}
                          value={formData.country}
                          onChange={handleChange}
                          required
                        >
                          <option disabled value="">-- select an option --</option>
                          {COUNTRIES.map(country => (
                            <option key={country.code} value={country.code}>
                              {country.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm text-slate-300 font-medium mb-1" htmlFor="password">
                          Password <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="password"
                          name="password"
                          className={inputClassName}
                          type="password"
                          placeholder="Password"
                          value={formData.password}
                          onChange={handleChange}
                          required
                          autoComplete="new-password"
                        />
                        <div className="text-xs text-slate-400 mt-2">
                          <p className="underline">Password Rules:</p>
                          <ul className="list-disc list-inside mt-1 space-y-0.5">
                            <li>It can't be similar to your other information.</li>
                            <li>It must contain at least 8 characters.</li>
                            <li>It can't be a commonly used password.</li>
                            <li>It can't be entirely numeric.</li>
                          </ul>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm text-slate-300 font-medium mb-1" htmlFor="password2">
                          Password (again) <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="password2"
                          name="password2"
                          className={inputClassName}
                          type="password"
                          placeholder="Password (again)"
                          value={formData.password2}
                          onChange={handleChange}
                          required
                          autoComplete="new-password"
                        />
                      </div>

                      <div>
                        <label className="block text-sm text-slate-300 font-medium mb-1" htmlFor="caveMarker">
                          Anti-Robot: What's the name of the cave marker indicating a jump? <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="caveMarker"
                          name="caveMarker"
                          className={inputClassName}
                          type="text"
                          placeholder="A***w"
                          value={formData.caveMarker}
                          onChange={handleChange}
                          required
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
                          'Creating Account...'
                        ) : (
                          <>
                            Sign Up 
                            <span className="ml-1 text-purple-300 group-hover:translate-x-0.5 transition-transform duration-150">→</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>

                  <div className="text-center mt-4">
                    <p className="text-sm text-slate-400">
                      Already have an account?{' '}
                      <Link 
                        to="/login" 
                        className="font-medium text-purple-500 hover:text-purple-400 transition-colors"
                      >
                        Sign in
                      </Link>
                    </p>
                  </div>

                  {/* Offline indicator */}
                  <div className="mt-8 text-center pb-[env(safe-area-inset-bottom)]">
                    <p className="text-xs text-slate-500 flex items-center justify-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${navigator.onLine ? 'bg-green-500' : 'bg-yellow-500'}`} />
                      {navigator.onLine ? 'Online' : 'Offline - Account will sync when online'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Cave Diver Verification Modal */}
          {showModal && (
            <div 
              className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center px-4 sm:px-6"
              onClick={() => setShowModal(false)}
            >
              <div 
                className="bg-slate-800 rounded-lg shadow-xl max-w-md w-full border border-slate-600"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-6">
                  {/* Modal header */}
                  <div className="mb-4 text-center">
                    <h2 className="text-xl font-semibold text-slate-100">
                      Access Restricted
                    </h2>
                  </div>
                  {/* Modal content */}
                  <div className="text-sm text-slate-300 mb-6 text-center">
                    <p>You're not a cave diver.</p>
                  </div>
                  {/* Modal footer */}
                  <div className="flex justify-center">
                    <button 
                      onClick={() => setShowModal(false)}
                      className="px-6 py-2 text-sm font-medium text-white bg-purple-500 hover:bg-purple-600 rounded-full transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Signup;
