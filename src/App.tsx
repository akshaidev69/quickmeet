import { Component, type ReactNode, useEffect, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { GoogleAuthBridge } from './components/GoogleAuthBridge';
import { HomeScreen } from './components/HomeScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { MarketingPage } from './components/MarketingPage';
import { MeetingScreen } from './components/MeetingScreen';
import { AuthProvider, useAuth } from './lib/auth';
import { formatCode, isFullCode } from './lib/code';
import { loadCustomBackground } from './lib/customBg';
import { saveMeeting } from './lib/api';
import { forgetMeeting, loadRecent, loadSchedule, loadSettings, rememberMeeting, saveSchedule, saveSettings } from './lib/storage';
import type { RecentMeeting, ScheduledMeeting, Settings } from './types';


type Phase = 'market' | 'login' | 'register' | 'home' | 'lobby' | 'room' | 'google-bridge';


function pathPhase(): Phase {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const room = new URLSearchParams(location.search).get('room');
  if (path === '/auth/google-bridge') return 'google-bridge';
  if (path === '/login') return 'login';
  if (path === '/register' || path === '/signup') return 'register';
  if (path === '/app' || room) return 'home';
  return 'market';
}


function routeFromUrl(instant: boolean, authed: boolean): { view: Phase; code: string } {
  const room = new URLSearchParams(location.search).get('room');
  const base = pathPhase();
  if (!authed) {
    if (base === 'google-bridge' || base === 'login' || base === 'register') return { view: base, code: '' };
    return { view: 'market', code: '' };
  }
  if (base === 'google-bridge') return { view: 'google-bridge', code: '' };
  if (room) {
    const code = formatCode(room);
