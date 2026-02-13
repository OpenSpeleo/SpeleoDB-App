import React from 'react';
import { Link } from 'react-router-dom';
import { IonPage, IonContent } from '@ionic/react';
import { PREFERENCES } from '../constants';
import { getPreferences } from '../services/PreferencesService';
import { getInstanceBaseUrl, INSTANCE_PATHS } from '../utils/url';
import ParticleAnimation from '../components/ParticleAnimation';
import logoSvg from '../assets/media/logo.png';
import glowTopSvg from '../assets/media/glow-top.svg';
import caveSvg from '../assets/media/cave.svg';

const Home: React.FC = () => {
  const instance = getPreferences().instance ?? PREFERENCES.DEFAULT_INSTANCE;
  const signupUrl = getInstanceBaseUrl(instance) + INSTANCE_PATHS.SIGNUP;

  return (
    <IonPage>
      <IonContent fullscreen className="ion-no-padding">
        <div className="font-sans antialiased bg-slate-900 text-slate-100 tracking-tight min-h-screen">
          {/* Header */}
          <header className="absolute w-full z-30 pt-[env(safe-area-inset-top)]">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <div className="flex items-center justify-end h-16 md:h-20">
                <a
                  href={signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-slate-300 hover:text-white rounded-full border border-slate-700 bg-slate-900/50 backdrop-blur-sm transition-colors duration-150 group"
                >
                  Sign Up
                  <span className="ml-1 text-purple-500 group-hover:translate-x-0.5 transition-transform duration-150">→</span>
                </a>
              </div>
            </div>
          </header>

          {/* Hero Section */}
          <section>
            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 min-h-screen flex flex-col justify-center">
              {/* Particles animation */}
              <div className="absolute inset-0 -z-10" aria-hidden="true">
                <ParticleAnimation quantity={30} staticity={50} ease={50} />
              </div>

              {/* Illustration */}
              <div className="absolute inset-0 -z-10 -mx-28 rounded-b-[3rem] pointer-events-none overflow-hidden" aria-hidden="true">
                <div className="absolute left-1/2 -translate-x-1/2 bottom-0 -z-10">
                  <img src={glowTopSvg} className="max-w-none" width="1404" height="658" alt="" />
                </div>
              </div>

              <div className="py-8">
                {/* Hero content */}
                <div className="w-full max-w-3xl mx-auto text-center">
                  
                  {/* Full width logo */}
                  <img src={logoSvg} alt="SpeleoDB" className="w-full" />
                  
                  <p className="text-lg text-slate-300 my-8 leading-relaxed">
                    We are a US-registered 501c3 non-profit organization aiming to provide
                    an intuitive and easy way to manage your cave survey data.
                    <br /><br />
                    We believe in team dynamics and synergies applied to cave survey.
                    SpeleoDB to foster and simplify team survey and collaboration.
                  </p>
                  
                  {/* CTA Button */}
                  <div className="flex justify-center">
                    <Link
                      to="/login"
                      className="inline-flex items-center justify-center px-6 py-3 text-sm font-medium text-slate-900 bg-gradient-to-r from-white/80 via-white to-white/80 hover:from-white hover:via-white hover:to-white rounded-full transition-all duration-150 group shadow-lg"
                    >
                      Get Started 
                      <span className="ml-1 text-purple-500 group-hover:translate-x-0.5 transition-transform duration-150">→</span>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Features Section */}
          <section>
            <div className="relative max-w-6xl mx-auto px-4 sm:px-6 min-h-screen">
              {/* Illustration */}
              <div className="absolute inset-0 -z-10 -mx-28 rounded-t-[3rem] pointer-events-none overflow-hidden" aria-hidden="true">
                <div className="absolute left-1/2 -translate-x-1/2 top-0 -z-10 rotate-180">
                  <img src={glowTopSvg} className="max-w-none" width="1404" height="658" alt="" />
                </div>
              </div>

              <div className="pt-16 pb-12 md:pt-52 md:pb-20">
                <div className="max-w-xl mx-auto md:max-w-none flex flex-col md:flex-row md:gap-8 lg:gap-16 xl:gap-20 gap-8">
                  {/* Content */}
                  <div className="md:w-7/12 lg:w-1/2 order-1 md:order-none text-center md:text-left">
                    <p className="inline-block font-medium text-transparent bg-gradient-to-r from-purple-500 to-purple-200 bg-clip-text pb-3">
                      The platform thought and designed for collaborative survey.
                    </p>
                    
                    <h3 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-slate-200/60 via-slate-200 to-slate-200/60 bg-clip-text text-transparent pb-3">
                      By and For Cave Divers
                    </h3>
                    
                    <p className="text-lg text-slate-400 mb-4">
                      Rely on the shoulder of giants to deliver you the most simple and intuitive experience.
                    </p>
                    
                    <hr className="border-slate-700" />
                    
                    <p className="text-lg text-slate-400 mt-4 mb-8">
                      Built on top of the state-of-the-art software git to save, manage, version, collaborate on survey data.
                    </p>
                    
                    {/* Feature Badges */}
                    <div className="mt-8 max-w-xs mx-auto md:mx-0 space-y-2">
                      <FeatureBadge icon="🔧" text="Powered by: Git" />
                      <FeatureBadge icon="🐍" text="Based on proven software: Django" />
                      <FeatureBadge icon="📦" text="Fully Open-Source on: Github" />
                      <FeatureBadge icon="☁️" text="Cloud or self-hosted service" />
                    </div>
                  </div>

                  {/* Image/Icon */}
                  <div className="md:w-5/12 lg:w-1/2">
                    <div className="relative py-24 -mt-12">
                      <div className="absolute inset-0 -z-10">
                        <ParticleAnimation quantity={8} staticity={30} />
                      </div>

                      <div className="flex items-center justify-center">
                        <div className="relative w-48 h-48 flex justify-center items-center">
                          {/* Halo effect */}
                          <svg 
                            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none blur-md" 
                            width="480" 
                            height="480" 
                            viewBox="0 0 480 480"
                          >
                            <defs>
                              <linearGradient id="pulse-a" x1="50%" x2="50%" y1="100%" y2="0%">
                                <stop offset="0%" stopColor="#A855F7" />
                                <stop offset="76.382%" stopColor="#FAF5FF" />
                                <stop offset="100%" stopColor="#6366F1" />
                              </linearGradient>
                            </defs>
                            <g fillRule="evenodd">
                              <path 
                                className="animate-pulse" 
                                fill="url(#pulse-a)" 
                                d="M240,0 C372.5484,0 480,107.4516 480,240 C480,372.5484 372.5484,480 240,480 C107.4516,480 0,372.5484 0,240 C0,107.4516 107.4516,0 240,0 Z M240,88.8 C156.4944,88.8 88.8,156.4944 88.8,240 C88.8,323.5056 156.4944,391.2 240,391.2 C323.5056,391.2 391.2,323.5056 391.2,240 C391.2,156.4944 323.5056,88.8 240,88.8 Z" 
                              />
                            </g>
                          </svg>
                          
                          {/* Cave Icon */}
                          <div className="relative flex items-center justify-center w-16 h-16 rounded-2xl shadow-2xl bg-slate-900 border border-slate-700">
                            <img className="h-[50px] rounded-md" src={caveSvg} alt="Cave" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Features #2 Section */}
          <section className="relative">
            <div className="absolute left-1/2 -translate-x-1/2 top-0 -z-10 w-80 h-80 -mt-24 -ml-32">
              <div className="absolute inset-0 -z-10" aria-hidden="true">
                <ParticleAnimation quantity={6} staticity={30} />
              </div>
            </div>

            <div className="max-w-6xl mx-auto px-4 sm:px-6 min-h-screen">
              <div className="pt-16 md:pt-32 pb-16 md:pb-32">
                {/* Section header */}
                <div className="max-w-3xl mx-auto text-center pb-12 md:pb-20">
                  <h2 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-slate-200/60 via-slate-200 to-slate-200/60 bg-clip-text text-transparent pb-4">
                    Data Privacy ~ Transparency ~ Distributed Future
                  </h2>
                  <p className="text-lg text-slate-400 text-justify">
                    <strong>SpeleoDB</strong>, developed by the Underwater Speleological and Archaeological Heritage Institute (USAH Institute), 
                    is a platform designed to address the unique needs of the cave survey and data collection community. 
                    We understand the critical importance of data privacy, ownership, and attribution.
                  </p>
                </div>

                {/* Feature Cards */}
                <div className="grid md:grid-cols-2 gap-6 pb-12 md:pb-20">
                  <FeatureCard 
                    title="Data Privacy"
                    description="At SpeleoDB, data privacy is our top priority. We understand the community's need for absolute control over their data. Our platform ensures that users maintain ownership and control over their information."
                  />
                  <FeatureCard 
                    title="Transparency"
                    description="SpeleoDB is committed to transparency in all aspects of its operation. As an open-source platform, our code is accessible for anyone to review, ensuring that our practices are open and accountable."
                  />
                </div>

                {/* Features list */}
                <div className="grid md:grid-cols-3 gap-8 md:gap-12">
                  <Feature title="Powered by GIT" description="SpeleoDB leverages GIT to version every survey, file or information, ensuring that all changes are tracked and recoverable." />
                  <Feature title="Forever Recoverable" description="Each modification is automatically versioned, allowing users to revert to any previous state, ensuring data integrity." />
                  <Feature title="Secure Backups" description="All data is backed up across multiple datacenters, providing robust protection against data loss." />
                  <Feature title="Open Source" description="SpeleoDB operates under an open-source model, welcoming contributions from anyone." />
                  <Feature title="Decentralized Future" description="We aim towards a decentralized future with SpeleoPUB. Run your own server, ensuring data ownership." />
                  <Feature title="Enhanced Workflows" description="Our platform and tools are designed to streamline and accelerate survey workflows." />
                </div>
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="border-t border-slate-800 pb-[env(safe-area-inset-bottom)]">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
              <div className="text-center text-sm text-slate-400">
                © {new Date().getFullYear()} SpeleoDB. All rights reserved.
              </div>
            </div>
          </footer>
        </div>
      </IonContent>
    </IonPage>
  );
};

// Helper Components - using only Tailwind classes
const FeatureBadge: React.FC<{ icon: string; text: string }> = ({ icon, text }) => (
  <span className="flex items-center text-sm font-medium text-slate-50 rounded-lg border border-purple-700 bg-slate-800/25 w-full px-3 py-2 shadow-sm shadow-purple-500/25">
    <span className="shrink-0 mr-3">{icon}</span>
    <span>{text}</span>
  </span>
);

const FeatureCard: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div className="relative h-full bg-slate-800 rounded-3xl p-px overflow-hidden">
    <div className="relative h-full bg-slate-900 rounded-[inherit] z-20 overflow-hidden">
      <div className="flex flex-col">
        {/* Glow effect */}
        <div className="absolute bottom-0 translate-y-1/2 left-1/2 -translate-x-1/2 pointer-events-none -z-10 w-1/2 aspect-square" aria-hidden="true">
          <div className="absolute inset-0 bg-slate-800 rounded-full blur-[80px]" />
        </div>
        <div className="p-6 md:p-8">
          <h3 className="text-xl font-bold bg-gradient-to-r from-slate-200/60 via-slate-200 to-slate-200/60 bg-clip-text text-transparent pb-1">
            {title}
          </h3>
          <p className="text-slate-400 text-justify">{description}</p>
        </div>
      </div>
    </div>
  </div>
);

const Feature: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div>
    <div className="flex items-center gap-2 mb-1">
      <svg className="shrink-0 w-4 h-4 fill-slate-300" viewBox="0 0 16 16">
        <path d="M14.3.3c.4-.4 1-.4 1.4 0 .4.4.4 1 0 1.4l-8 8c-.2.2-.4.3-.7.3-.3 0-.5-.1-.7-.3-.4-.4-.4-1 0-1.4l8-8ZM15 7c.6 0 1 .4 1 1 0 4.4-3.6 8-8 8s-8-3.6-8-8 3.6-8 8-8c.6 0 1 .4 1 1s-.4 1-1 1C4.7 2 2 4.7 2 8s2.7 6 6 6 6-2.7 6-6c0-.6.4-1 1-1Z" />
      </svg>
      <h4 className="font-medium text-slate-50">{title}</h4>
    </div>
    <p className="text-sm text-slate-400 text-justify">{description}</p>
  </div>
);

export default Home;
