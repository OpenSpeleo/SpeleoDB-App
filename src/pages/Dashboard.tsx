import React, { useEffect, useState } from 'react';
import { Link, useHistory } from 'react-router-dom';
import { IonPage, IonContent, IonRefresher, IonRefresherContent } from '@ionic/react';
import { useSpeleoDB } from '../context/SpeleoDBProvider';
import type { User } from '../types';
import logoSvg from '../assets/media/logo.png';

const Dashboard: React.FC = () => {
  const history = useHistory();
  const { controller, isOnline, projects, syncStatus } = useSpeleoDB();
  const [user, setUser] = useState<User | null>(null);
  const didSyncRef = React.useRef(false);

  useEffect(() => {
    if (!controller.isAuthenticated()) {
      history.push('/login');
      return;
    }
    setUser(controller.currentUser);

    // Trigger project sync once when the dashboard mounts.
    if (!didSyncRef.current) {
      didSyncRef.current = true;
      controller.syncProjects();
    }
  }, [history, controller]);

  const handleRefresh = async (event: CustomEvent) => {
    await controller.syncProjects();
    event.detail.complete();
  };

  const handleLogout = () => {
    controller.logout();
    history.push('/');
  };

  if (!user) {
    return null;
  }

  return (
    <IonPage>
      <IonContent fullscreen className="ion-no-padding">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh} pullFactor={0.5} pullMin={60} pullMax={200}>
          <IonRefresherContent
            pullingIcon="arrow-down-outline"
            pullingText="Pull down to refresh"
            refreshingSpinner="crescent"
            refreshingText="Syncing projects…"
          />
        </IonRefresher>
        <div className="font-sans antialiased bg-slate-900 text-slate-100 tracking-tight min-h-screen flex flex-col">
          {/* Header */}
          <header className="border-b border-slate-800 pt-[env(safe-area-inset-top)]">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <div className="flex items-center justify-between h-16 md:h-20">
                {/* Logo */}
                <div className="flex-1">
                  <Link to="/" className="inline-flex items-center py-2">
                    <img className="max-w-none h-8 md:h-10" src={logoSvg} alt="SpeleoDB" />
                  </Link>
                </div>

                {/* Sync indicator + User menu */}
                <div className="flex items-center gap-4">
                  {syncStatus === 'syncing' && (
                    <span className="flex items-center gap-1.5 text-xs text-slate-400">
                      <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                      Syncing…
                    </span>
                  )}
                  <span className="text-sm text-slate-300">{user.name}</span>
                  <button
                    onClick={handleLogout}
                    className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-300 hover:text-white rounded-full border border-slate-700 bg-slate-900/50 transition-colors group"
                  >
                    Sign Out
                    <span className="ml-1 text-purple-500 group-hover:translate-x-0.5 transition-transform duration-150">→</span>
                  </button>
                </div>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 max-w-6xl mx-auto px-4 sm:px-6 py-12 w-full">
            <div className="mb-8">
              <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-slate-200/60 via-slate-200 to-slate-200/60 bg-clip-text text-transparent mb-4">
                Welcome, {user.name}!
              </h1>
              <p className="text-slate-400">
                This is your SpeleoDB dashboard. From here, you can manage your cave surveys and collaborate with your team.
              </p>
              {projects.length > 0 && (
                <p className="text-sm text-slate-500 mt-2">
                  {projects.length} project{projects.length !== 1 ? 's' : ''} cached for offline access
                  {syncStatus === 'done' && <span className="text-green-500 ml-1">· up to date</span>}
                </p>
              )}
            </div>

            {/* Dashboard Cards */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              <DashboardCard
                title="My Surveys"
                description="View and manage your cave survey projects."
                icon={
                  <svg className="w-8 h-8 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                }
              />

              <DashboardCard
                title="Team"
                description="Collaborate with your survey team members."
                icon={
                  <svg className="w-8 h-8 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                }
              />

              <DashboardCard
                title="Settings"
                description="Configure your account and preferences."
                icon={
                  <svg className="w-8 h-8 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                }
              />
            </div>

            {/* Account Info */}
            <div className="mt-12 p-6 bg-slate-800/50 rounded-2xl border border-slate-700">
              <h2 className="text-lg font-semibold text-slate-100 mb-4">Account Information</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-700">
                  <span className="text-slate-400">Email</span>
                  <span className="text-slate-200">{user.email}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700">
                  <span className="text-slate-400">Name</span>
                  <span className="text-slate-200">{user.name}</span>
                </div>
                {user.country && (
                  <div className="flex justify-between items-center py-2 border-b border-slate-700">
                    <span className="text-slate-400">Country</span>
                    <span className="text-slate-200">{user.country}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2">
                  <span className="text-slate-400">Status</span>
                  <span className="flex items-center gap-2 text-slate-200">
                    <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-yellow-500'}`} />
                    {isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>
            </div>
          </main>

          {/* Footer */}
          <footer className="border-t border-slate-800 mt-auto pb-[env(safe-area-inset-bottom)]">
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

// Dashboard Card Component
const DashboardCard: React.FC<{ title: string; description: string; icon: React.ReactNode }> = ({ 
  title, 
  description, 
  icon 
}) => (
  <div className="p-6 bg-slate-800/50 rounded-2xl border border-slate-700 hover:border-purple-500/50 transition-colors cursor-pointer">
    <div className="mb-4">{icon}</div>
    <h3 className="text-lg font-semibold text-slate-100 mb-2">{title}</h3>
    <p className="text-sm text-slate-400">{description}</p>
  </div>
);

export default Dashboard;
