/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Wrench, Star, Phone, MapPin, Clock, ArrowLeft, CheckCircle2, Navigation, ShieldCheck, History, Map as MapIcon, LogOut, MessageCircle, Send, X, AlertTriangle, Calendar, Users, Car, Bike, Sparkles, Bot, User as UserIcon, DollarSign, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, signInWithGoogle, logOut } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, onSnapshot, query, where, orderBy, updateDoc, doc, serverTimestamp, setDoc, getDocFromServer, limit } from 'firebase/firestore';
import { io, Socket } from 'socket.io-client';

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  public props: { children: React.ReactNode };
  public state: { hasError: boolean, error: Error | null };

  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.props = props;
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsedError = JSON.parse(this.state.error?.message || "");
        if (parsedError.error) {
          errorMessage = `Firestore Error: ${parsedError.error} during ${parsedError.operationType} on ${parsedError.path}`;
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <X className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Application Error</h2>
            <p className="text-gray-600 mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Custom Leaflet Icons ---
const createIcon = (color: string, iconHtml: string) => L.divIcon({
  className: 'custom-marker',
  html: `<div style="background-color: ${color}; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 3px 6px rgba(0,0,0,0.3); color: white;">${iconHtml}</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18]
});

const mechanicIconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const carIconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`;
const bikeIconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>`;
const userIconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;

const getMechanicIcon = (category?: string) => {
  if (category === 'car') return createIcon('#3b82f6', carIconHtml);
  if (category === 'bike') return createIcon('#a855f7', bikeIconHtml);
  return createIcon('#ef4444', mechanicIconHtml);
};

const userIcon = createIcon('#3b82f6', userIconHtml); // Blue for user

import { diagnoseIssue, DiagnosticResult, ai as geminiAi } from './services/geminiService';

// --- Constants ---
const DEFAULT_LOCATION: [number, number] = [13.3486, 80.1144]; // Kavaraipettai, Thiruvallur, Tamil Nadu

type Mechanic = {
  id: string;
  name: string;
  rating: number;
  reviews: number;
  distance: string;
  specialty: string;
  phone: string;
  location: [number, number];
  eta: string;
  price: string;
  image: string;
  isAvailable?: boolean;
  experience?: string;
  bio?: string;
  category?: 'car' | 'bike' | 'both';
};

// Helper component to recenter map
function MapUpdater({ center, bounds }: { center?: [number, number], bounds?: L.LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, map.getZoom());
    }
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [center, bounds, map]);
  return null;
}

export default function App() {
  const [userLocation, setUserLocation] = useState<[number, number]>(DEFAULT_LOCATION);
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<'user' | 'mechanic'>('user');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [selectedMechanic, setSelectedMechanic] = useState<Mechanic | null>(null);
  const [bookingState, setBookingState] = useState<'idle' | 'confirming' | 'tracking'>('idle');
  const [liveLocation, setLiveLocation] = useState<[number, number] | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [mechanicStatus, setMechanicStatus] = useState<'en_route' | 'arrived' | 'payment_pending'>('en_route');
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [currentTab, setCurrentTab] = useState<'map' | 'mechanics' | 'bookings' | 'ai'>('map');
  const [bookingHistory, setBookingHistory] = useState<any[]>([]);

  const [mechanicBookings, setMechanicBookings] = useState<any[]>([]);
  const [mechanicHistory, setMechanicHistory] = useState<any[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [vehicleInfo, setVehicleInfo] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [serviceType, setServiceType] = useState('general_maintenance');
  const [userPhone, setUserPhone] = useState('');
  const [bookingType, setBookingType] = useState<'emergency' | 'scheduled'>('emergency');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [mechanicCategoryFilter, setMechanicCategoryFilter] = useState<'all' | 'car' | 'bike'>('all');
  const [specialtyFilter, setSpecialtyFilter] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState(false);
  const [showBookingConfirmation, setShowBookingConfirmation] = useState(false);
  const [showBookingWizard, setShowBookingWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [aiDiagnosis, setAiDiagnosis] = useState<DiagnosticResult | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [aiMessages, setAiMessages] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [isAiThinking, setIsAiThinking] = useState(false);

  // Initialize Socket.io
  useEffect(() => {
    socketRef.current = io();

    socketRef.current.on('notification', (notif) => {
      setNotifications(prev => [...prev, { ...notif, id: Date.now() }]);
      // Auto-remove notification after 5 seconds
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== notif.id));
      }, 5000);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  // Join room when user is ready
  useEffect(() => {
    if (user && socketRef.current) {
      socketRef.current.emit('join', user.uid);
    }
  }, [user]);

  // Test Firestore connection on boot
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
        }
        // Skip logging for other errors, as this is simply a connection test.
      }
    }
    testConnection();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isChatOpen]);

  // Listen to auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Listen to user document to get role and handle profile creation
  useEffect(() => {
    if (!user) {
      setUserRole('user');
      return;
    }

    const unsubscribeUser = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
      const pendingRole = localStorage.getItem('pendingRole');
      
      if (docSnap.exists()) {
        const currentData = docSnap.data();
        if (pendingRole && pendingRole !== currentData.role) {
          // Update role if they explicitly chose a different one during login
          updateDoc(doc(db, 'users', user.uid), { 
            role: pendingRole,
            ...(pendingRole === 'mechanic' && !currentData.specialty ? {
              specialty: 'General Auto Repair',
              category: 'car',
              phone: '+1 555-0123',
              price: '$85/hr',
              eta: '15 mins',
              rating: 4.8,
              reviews: 12,
              isAvailable: true,
              location: [40.7128 + (Math.random() - 0.5) * 0.05, -74.0060 + (Math.random() - 0.5) * 0.05],
              image: `https://picsum.photos/seed/${user.uid}/200/200`
            } : {})
          }).catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`));
          localStorage.removeItem('pendingRole');
        } else {
          setUserRole(currentData.role || 'user');
          if (pendingRole) localStorage.removeItem('pendingRole');
        }
      } else {
        // Create default user profile
        const roleToSet = pendingRole || 'user';
        const mechanicData = roleToSet === 'mechanic' ? {
          specialty: 'General Auto Repair',
          category: 'car',
          phone: '+1 555-0123',
          price: '$85/hr',
          eta: '15 mins',
          rating: 4.8,
          reviews: 12,
          isAvailable: true,
          location: [userLocation[0] + (Math.random() - 0.5) * 0.05, userLocation[1] + (Math.random() - 0.5) * 0.05],
          image: `https://picsum.photos/seed/${user.uid}/200/200`
        } : {};

        setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          name: user.displayName || 'User',
          email: user.email || '',
          role: roleToSet,
          ...mechanicData,
          createdAt: serverTimestamp()
        }, { merge: true }).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`));
        
        if (pendingRole) localStorage.removeItem('pendingRole');
      }
    }, (e) => handleFirestoreError(e, OperationType.GET, `users/${user.uid}`));

    return () => unsubscribeUser();
  }, [user]);

  // Fetch mechanics from Firestore
  useEffect(() => {
    if (!isAuthReady || !user) return;
    
    const q = query(
      collection(db, 'users'),
      where('role', '==', 'mechanic'),
      limit(5)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const mechs = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id as any, // using string ID from firestore
          name: data.name || 'Unknown Mechanic',
          rating: data.rating || 4.5,
          reviews: data.reviews || 10,
          distance: data.distance || '2.5 km',
          specialty: data.specialty || 'General Auto Repair',
          phone: data.phone || '+1 555-0123',
          location: data.location || [userLocation[0] + (Math.random() - 0.5) * 0.05, userLocation[1] + (Math.random() - 0.5) * 0.05],
          eta: data.eta || '15 mins',
          price: data.price || '$85/hr',
          image: data.image || `https://picsum.photos/seed/${doc.id}/200/200`,
          isAvailable: data.isAvailable !== false,
          experience: data.experience || '5+ years',
          bio: data.bio || 'Professional mechanic dedicated to providing high-quality service.'
        };
      });
      setMechanics(mechs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  // Fetch mechanic's active bookings
  useEffect(() => {
    if (!isAuthReady || !user || userRole !== 'mechanic') return;
    
    const q = query(
      collection(db, 'bookings'),
      where('mechanicId', '==', user.uid),
      where('status', 'in', ['active', 'en_route', 'arrived', 'payment_pending']),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const bookings = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setMechanicBookings(bookings);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'bookings');
    });

    return () => unsubscribe();
  }, [isAuthReady, user, userRole]);

  // Fetch mechanic's booking history
  useEffect(() => {
    if (!isAuthReady || !user || userRole !== 'mechanic') return;
    
    const q = query(
      collection(db, 'bookings'),
      where('mechanicId', '==', user.uid),
      where('status', '==', 'completed'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setMechanicHistory(history);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'bookings');
    });

    return () => unsubscribe();
  }, [isAuthReady, user, userRole]);

  // Fetch booking history from Firestore
  useEffect(() => {
    if (!isAuthReady || !user) return;
    
    const q = query(
      collection(db, 'bookings'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setBookingHistory(history);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'bookings');
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  const toggleRole = async () => {
    if (!user) return;
    const newRole = userRole === 'user' ? 'mechanic' : 'user';
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        role: newRole
      });
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const handleAiChat = async () => {
    if (!aiInput.trim()) return;
    const userMsg = aiInput;
    setAiInput('');
    setAiMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsAiThinking(true);
    try {
      const response = await geminiAi.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: userMsg,
        config: {
          systemInstruction: "You are a helpful automotive and motorcycle expert. Provide advice on vehicle maintenance, troubleshooting, and general automotive knowledge. Be concise and professional."
        }
      });
      setAiMessages(prev => [...prev, { role: 'model', text: response.text || "I'm sorry, I couldn't process that." }]);
    } catch (error) {
      setAiMessages(prev => [...prev, { role: 'model', text: "AI Assistant is currently unavailable." }]);
    } finally {
      setIsAiThinking(false);
    }
  };

  const handleAiDiagnose = async () => {
    if (!issueDescription.trim() || !vehicleInfo.trim()) {
      alert("Please provide vehicle info and describe the issue first.");
      return;
    }
    setIsDiagnosing(true);
    setAiDiagnosis(null);
    try {
      const result = await diagnoseIssue(issueDescription, vehicleInfo);
      setAiDiagnosis(result);
    } catch (error) {
      alert("AI Assistant is currently unavailable.");
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleToggleAvailability = async (id: string, currentStatus: boolean | undefined) => {
    try {
      const newStatus = currentStatus === undefined ? false : !currentStatus;
      await updateDoc(doc(db, 'users', id), {
        isAvailable: newStatus
      });
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${id}`);
    }
  };

  // Handle payment success redirect
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentSuccess = urlParams.get('payment_success');
    const bookingIdParam = urlParams.get('booking_id');

    if (paymentSuccess === 'true' && bookingIdParam) {
      const completeBooking = async () => {
        try {
          await updateDoc(doc(db, 'bookings', bookingIdParam), {
            status: 'completed',
            paid: true
          });
          setBookingState('idle');
          setBookingId(null);
          setSelectedMechanic(null);
          setMechanicStatus('en_route');
          setLiveLocation(null);
          setCurrentTab('history');
          // Remove query params
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch (error: any) {
          handleFirestoreError(error, OperationType.UPDATE, `bookings/${bookingIdParam}`);
        }
      };
      completeBooking();
    }
  }, []);

  // Fetch active booking for user on load
  useEffect(() => {
    if (!isAuthReady || !user || userRole !== 'user') return;
    
    const q = query(
      collection(db, 'bookings'),
      where('userId', '==', user.uid),
      where('status', 'in', ['active', 'en_route', 'arrived', 'payment_pending']),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const activeBookingDoc = snapshot.docs[0];
        const data = activeBookingDoc.data();
        
        setBookingId(activeBookingDoc.id);
        
        if (data.status === 'en_route' || data.status === 'arrived' || data.status === 'payment_pending') {
          setBookingState('tracking');
          setMechanicStatus(data.status);
          if (data.mechanicLocation) {
            setLiveLocation(data.mechanicLocation);
          }
        } else if (data.status === 'active') {
          setBookingState('confirming');
        }
        
        // Reconstruct selectedMechanic from booking data if it's missing
        setSelectedMechanic(prev => prev || {
          id: data.mechanicId,
          name: data.mechanicName,
          phone: data.mechanicPhone || '',
          price: data.mechanicPrice || '',
          eta: data.mechanicEta || '',
          image: data.mechanicImage || '',
          rating: 4.8, // Fallback
          reviews: 12, // Fallback
          distance: 'Unknown', // Fallback
          specialty: 'General Auto Repair', // Fallback
          location: data.mechanicLocation || [0, 0]
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'bookings');
    });

    return () => unsubscribe();
  }, [isAuthReady, user, userRole]);

  // Fetch messages for active booking
  useEffect(() => {
    if (!bookingId) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, `bookings/${bookingId}/messages`),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `bookings/${bookingId}/messages`);
    });

    return () => unsubscribe();
  }, [bookingId]);

  // Handle live tracking updates for user
  useEffect(() => {
    if (userRole === 'user' && bookingId) {
      const unsubscribe = onSnapshot(doc(db, 'bookings', bookingId), (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.status === 'en_route' || data.status === 'arrived' || data.status === 'payment_pending') {
            setBookingState('tracking');
            setMechanicStatus(data.status);
            if (data.mechanicLocation) {
              setLiveLocation(data.mechanicLocation);
            }
          } else if (data.status === 'completed' || data.status === 'cancelled') {
            setBookingState('idle');
            setSelectedMechanic(null);
            setLiveLocation(null);
            setBookingId(null);
            setCurrentTab('history');
          }
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `bookings/${bookingId}`);
      });

      return () => unsubscribe();
    }
  }, [bookingId, userRole]);

  const handleBook = () => {
    if (!selectedMechanic || !user) return;
    setShowBookingConfirmation(true);
  };

  const processBooking = async () => {
    if (!selectedMechanic || !user) return;
    
    setShowBookingConfirmation(false);
    setBookingState('confirming');
    
    try {
      const docRef = await addDoc(collection(db, 'bookings'), {
        userId: user.uid,
        userName: user.displayName || 'Customer',
        userPhoto: user.photoURL,
        userPhone: userPhone || '+1 555-9876',
        vehicleInfo: vehicleInfo || 'Not specified',
        issueDescription: issueDescription || 'Not specified',
        mechanicId: selectedMechanic.id,
        mechanicName: selectedMechanic.name,
        mechanicPhone: selectedMechanic.phone,
        mechanicPrice: selectedMechanic.price,
        mechanicEta: selectedMechanic.eta,
        mechanicImage: selectedMechanic.image,
        date: new Date().toISOString(),
        status: 'active',
        location: userLocation,
        mechanicLocation: selectedMechanic.location,
        bookingType,
        serviceType,
        scheduledDate: bookingType === 'scheduled' ? scheduledDate : null,
        scheduledTime: bookingType === 'scheduled' ? scheduledTime : null,
        createdAt: serverTimestamp()
      });
      
      setBookingId(docRef.id);
      setLiveLocation(selectedMechanic.location);

      // Notify mechanic of new booking
      socketRef.current?.emit('send_notification', {
        targetUserId: selectedMechanic.id,
        title: 'New Booking Request',
        body: `You have a new booking request from ${user.displayName || 'a customer'}.`,
        type: 'new_booking'
      });
      
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'bookings');
      setBookingState('idle');
      alert('Failed to book mechanic. Please try again.');
    }
  };

  const handleCancel = async () => {
    if (bookingId) {
      try {
        await updateDoc(doc(db, 'bookings', bookingId), {
          status: 'cancelled'
        });
      } catch (error: any) {
        handleFirestoreError(error, OperationType.UPDATE, `bookings/${bookingId}`);
      }
    }
    
    setBookingState('idle');
    setSelectedMechanic(null);
    setLiveLocation(null);
    setBookingId(null);
  };

  const handleCancelBooking = async (id: string) => {
    try {
      await updateDoc(doc(db, 'bookings', id), {
        status: 'cancelled'
      });
      if (bookingId === id) {
        setBookingState('idle');
        setBookingId(null);
        setSelectedMechanic(null);
        setLiveLocation(null);
      }
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${id}`);
    }
  };

  const handlePayment = async () => {
    if (!bookingId || !selectedMechanic) return;
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          mechanicName: selectedMechanic.name,
          priceString: selectedMechanic.price
        })
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Payment error: ' + data.error);
      }
    } catch (error) {
      console.error('Payment error:', error);
      alert('Failed to initiate payment.');
    }
  };

  const handleAcceptBooking = async (bookingId: string) => {
    try {
      const booking = mechanicBookings.find(b => b.id === bookingId);
      await updateDoc(doc(db, 'bookings', bookingId), {
        status: 'en_route'
      });

      // Notify user that mechanic is en route
      if (booking?.userId) {
        socketRef.current?.emit('send_notification', {
          targetUserId: booking.userId,
          title: 'Mechanic En Route',
          body: `${user?.displayName || 'Your mechanic'} is on the way!`,
          type: 'en_route'
        });
      }
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${bookingId}`);
    }
  };

  const handleArriveBooking = async (bookingId: string) => {
    try {
      const booking = mechanicBookings.find(b => b.id === bookingId);
      await updateDoc(doc(db, 'bookings', bookingId), {
        status: 'arrived'
      });

      // Notify user that mechanic has arrived
      if (booking?.userId) {
        socketRef.current?.emit('send_notification', {
          targetUserId: booking.userId,
          title: 'Mechanic Arrived',
          body: `${user?.displayName || 'Your mechanic'} has arrived at your location!`,
          type: 'arrived'
        });
      }
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${bookingId}`);
    }
  };

  const handleRequestPayment = async (bookingId: string) => {
    try {
      await updateDoc(doc(db, 'bookings', bookingId), {
        status: 'payment_pending'
      });
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${bookingId}`);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.currentTarget);
    const updates = {
      name: formData.get('name') as string,
      specialty: formData.get('specialty') as string,
      category: formData.get('category') as 'car' | 'bike' | 'both',
      price: formData.get('price') as string,
      experience: formData.get('experience') as string,
      bio: formData.get('bio') as string,
    };

    try {
      await updateDoc(doc(db, 'users', user.uid), updates);
      setIsEditingProfile(false);
      alert('Profile updated successfully!');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !bookingId || !user) return;

    try {
      await addDoc(collection(db, `bookings/${bookingId}/messages`), {
        text: newMessage.trim(),
        senderId: user.uid,
        createdAt: serverTimestamp()
      });
      setNewMessage('');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, `bookings/${bookingId}/messages`);
    }
  };

  const seedSampleMechanics = async () => {
    if (!user) return;
    const sampleMechs = [
      {
        name: "Alex 'The Wrench' Rivera",
        specialty: "Engine & Transmission Specialist",
        phone: "+1 555-0101",
        price: "$95/hr",
        category: "car",
        eta: "12 mins",
        rating: 4.9,
        reviews: 42,
        isAvailable: true,
        location: [userLocation[0] + 0.008, userLocation[1] - 0.005],
        image: "https://images.unsplash.com/photo-1590611380053-eaf3d133000a?w=400&h=400&fit=cover",
        role: "mechanic",
        email: "alex@example.com",
        experience: "12 years",
        bio: "Master technician with a passion for high-performance engines. I specialize in complex transmission repairs and engine rebuilds."
      },
      {
        name: "Sarah Chen",
        specialty: "Electrical & Hybrid Systems",
        phone: "+1 555-0102",
        price: "$110/hr",
        category: "car",
        eta: "8 mins",
        rating: 4.7,
        reviews: 28,
        isAvailable: true,
        location: [userLocation[0] - 0.005, userLocation[1] + 0.008],
        image: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&h=400&fit=cover",
        role: "mechanic",
        email: "sarah@example.com",
        experience: "8 years",
        bio: "Certified hybrid specialist. I love solving complex electrical gremlins and keeping the latest eco-friendly vehicles on the road."
      },
      {
        name: "Marcus Johnson",
        specialty: "Tires, Brakes & Suspension",
        phone: "+1 555-0103",
        price: "$75/hr",
        category: "both",
        eta: "20 mins",
        rating: 4.6,
        reviews: 156,
        isAvailable: true,
        location: [userLocation[0] + 0.003, userLocation[1] + 0.012],
        image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=cover",
        role: "mechanic",
        email: "marcus@example.com",
        experience: "15 years",
        bio: "Fast, reliable, and honest. I've changed more tires than I can count. Your safety is my top priority when it comes to brakes and suspension."
      },
      {
        name: "Elena Rodriguez",
        specialty: "Emergency Roadside & Diagnostics",
        phone: "+1 555-0104",
        price: "$85/hr",
        category: "car",
        eta: "5 mins",
        rating: 5.0,
        reviews: 18,
        isAvailable: true,
        location: [userLocation[0] - 0.006, userLocation[1] - 0.004],
        image: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&h=400&fit=cover",
        role: "mechanic",
        email: "elena@example.com",
        experience: "6 years",
        bio: "I'm the one you call when you're stranded. Expert in quick diagnostics and getting you back on the road in record time."
      },
      {
        name: "Rajesh Kumar",
        specialty: "Bike Engine & Chain Specialist",
        phone: "+1 555-0105",
        price: "$45/hr",
        category: "bike",
        eta: "10 mins",
        rating: 4.8,
        reviews: 64,
        isAvailable: true,
        location: [userLocation[0] + 0.004, userLocation[1] + 0.003],
        image: "https://images.unsplash.com/photo-1531427186611-ecfd6d936c79?w=400&h=400&fit=cover",
        role: "mechanic",
        email: "rajesh@example.com",
        experience: "10 years",
        bio: "Specialist in two-wheelers. From super-bikes to daily commuters, I handle them all with precision."
      },
      {
        name: "Priya Sharma",
        specialty: "Two-Wheeler Electricals",
        phone: "+1 555-0106",
        price: "$40/hr",
        category: "bike",
        eta: "15 mins",
        rating: 4.9,
        reviews: 32,
        isAvailable: true,
        location: [userLocation[0] - 0.002, userLocation[1] + 0.005],
        image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=cover",
        role: "mechanic",
        email: "priya@example.com",
        experience: "5 years",
        bio: "Expert in bike wiring and battery issues. I'll get your bike started in no time."
      },
      {
        name: "Tom 'Turbo' Wilson",
        specialty: "Performance Tuning & Car Mods",
        phone: "+1 555-0107",
        price: "$120/hr",
        category: "car",
        eta: "18 mins",
        rating: 4.9,
        reviews: 89,
        isAvailable: true,
        location: [userLocation[0] + 0.009, userLocation[1] - 0.008],
        image: "https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=400&h=400&fit=cover",
        role: "mechanic",
        email: "tom@example.com",
        experience: "14 years",
        bio: "If you want your car to go faster and sound better, I'm your guy. Specialist in performance tuning and custom modifications."
      }
    ];

    try {
      for (const mech of sampleMechs) {
        const mechId = `sample_mech_${Math.random().toString(36).substr(2, 9)}`;
        await setDoc(doc(db, 'users', mechId), {
          uid: mechId,
          ...mech,
          createdAt: serverTimestamp()
        });
      }
      alert('Sample mechanics added successfully!');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, 'users');
    }
  };

  // Auto-seed if no mechanics exist
  useEffect(() => {
    if (isAuthReady && user && mechanics.length === 0) {
      const timer = setTimeout(() => {
        if (mechanics.length === 0) {
          seedSampleMechanics();
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isAuthReady, user, mechanics.length]);

  if (!isAuthReady) {
    return <div className="flex h-screen items-center justify-center bg-gray-50"><div className="w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div></div>;
  }

  if (!user) {
    const handleLogin = (role: 'user' | 'mechanic') => {
      localStorage.setItem('pendingRole', role);
      signInWithGoogle();
    };

    return (
      <div className="flex flex-col h-screen bg-gray-50 font-sans items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center">
          <div className="bg-red-500 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-red-500/30">
            <Wrench className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">MechRescue</h1>
          <p className="text-gray-500 mb-8">On-demand mechanics at your location.</p>
          
          <div className="space-y-4">
            <button 
              onClick={() => handleLogin('user')}
              className="w-full bg-white border-2 border-gray-200 hover:border-red-500 hover:bg-red-50 text-gray-700 font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-3 transition-all"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Login as Customer
            </button>

            <button 
              onClick={() => handleLogin('mechanic')}
              className="w-full bg-white border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 text-gray-700 font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-3 transition-all"
            >
              <Wrench className="w-5 h-5 text-blue-500" />
              Login as Mechanic
            </button>
          </div>
        </div>
      </div>
    );
  }

  const filteredMechanics = mechanics.filter(mech => {
    const matchesCategory = mechanicCategoryFilter === 'all' || mech.category === mechanicCategoryFilter || mech.category === 'both';
    const matchesSpecialty = !specialtyFilter || mech.specialty.toLowerCase().includes(specialtyFilter.toLowerCase());
    const matchesAvailability = !availabilityFilter || mech.isAvailable !== false;
    return matchesCategory && matchesSpecialty && matchesAvailability;
  }).sort((a, b) => {
    if (!aiDiagnosis) return 0;
    const aRec = a.category === aiDiagnosis.recommendedCategory || a.category === 'both';
    const bRec = b.category === aiDiagnosis.recommendedCategory || b.category === 'both';
    if (aRec && !bRec) return -1;
    if (!aRec && bRec) return 1;
    return 0;
  });

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-gray-50 font-sans overflow-hidden">
      {/* Notifications Toast */}
      <div className="fixed top-20 right-4 z-[100] space-y-2 pointer-events-none">
        <AnimatePresence>
          {notifications.map((notif) => (
            <motion.div
              key={notif.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 50, scale: 0.9 }}
              className="bg-white border-l-4 border-red-500 shadow-xl rounded-lg p-4 w-72 pointer-events-auto"
            >
              <div className="flex items-start gap-3">
                <div className="bg-red-50 p-2 rounded-full">
                  <Wrench className="w-4 h-4 text-red-500" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-gray-900">{notif.title}</h4>
                  <p className="text-xs text-gray-600 mt-1">{notif.body}</p>
                </div>
                <button 
                  onClick={() => setNotifications(prev => prev.filter(n => n.id !== notif.id))}
                  className="ml-auto text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Booking Wizard Modal */}
      <AnimatePresence>
        {showBookingWizard && (
          <div className="fixed inset-0 z-[1000] flex items-end md:items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              className="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-10 flex-shrink-0">
                <h3 className="text-xl font-bold text-gray-900">
                  {wizardStep === 1 ? 'Service Details' : 'Vehicle & Issue'}
                </h3>
                <button onClick={() => { setShowBookingWizard(false); setSelectedMechanic(null); }} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1">
                {wizardStep === 1 && (
                  <div className="space-y-6">
                    {/* Urgency */}
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-3">Service Urgency</label>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setBookingType('emergency')}
                          className={`flex-1 flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all ${bookingType === 'emergency' ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-100 hover:border-red-200'}`}
                        >
                          <AlertTriangle className={`w-6 h-6 ${bookingType === 'emergency' ? 'text-red-500' : 'text-gray-400'}`} />
                          <span className="font-bold text-sm">Emergency</span>
                        </button>
                        <button
                          onClick={() => setBookingType('scheduled')}
                          className={`flex-1 flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all ${bookingType === 'scheduled' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-100 hover:border-blue-200'}`}
                        >
                          <Calendar className={`w-6 h-6 ${bookingType === 'scheduled' ? 'text-blue-500' : 'text-gray-400'}`} />
                          <span className="font-bold text-sm">Scheduled</span>
                        </button>
                      </div>
                    </div>

                    {/* Date/Time if Scheduled */}
                    {bookingType === 'scheduled' && (
                      <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Date</label>
                          <input 
                            type="date" 
                            value={scheduledDate}
                            onChange={(e) => setScheduledDate(e.target.value)}
                            min={new Date().toISOString().split('T')[0]}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Time</label>
                          <input 
                            type="time" 
                            value={scheduledTime}
                            onChange={(e) => setScheduledTime(e.target.value)}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
                          />
                        </div>
                      </div>
                    )}

                    {/* Service Type */}
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-3">Type of Service</label>
                      <div className="space-y-2">
                        {[
                          { id: 'general_maintenance', label: 'General Maintenance', desc: 'Oil change, tune-up, standard checks' },
                          { id: 'emergency_repair', label: 'Emergency Repair', desc: 'Breakdown, won\'t start, accidents' },
                          { id: 'part_replacement', label: 'Specific Part Replacement', desc: 'Brakes, Battery, Tires, etc.' },
                          { id: 'diagnostics', label: 'Inspection / Diagnostics', desc: 'Strange noises, check engine light' }
                        ].map(type => (
                          <div 
                            key={type.id}
                            onClick={() => setServiceType(type.id)}
                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${serviceType === type.id ? 'border-red-500 bg-red-50' : 'border-gray-100 hover:border-red-200 bg-white'}`}
                          >
                            <div className="font-bold text-sm text-gray-900">{type.label}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{type.desc}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <button 
                      onClick={() => setWizardStep(2)}
                      disabled={bookingType === 'scheduled' && (!scheduledDate || !scheduledTime)}
                      className="w-full py-4 bg-gray-900 text-white font-bold rounded-xl transition-all disabled:bg-gray-300 active:scale-[0.98] mt-2 group flex items-center justify-center gap-2"
                    >
                      Next Step <ArrowLeft className="w-4 h-4 rotate-180" />
                    </button>
                  </div>
                )}

                {wizardStep === 2 && (
                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-1">Vehicle Make & Model</label>
                      <input 
                        type="text" 
                        value={vehicleInfo}
                        onChange={(e) => setVehicleInfo(e.target.value)}
                        placeholder="e.g. 2018 Toyota Camry"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all"
                      />
                    </div>

                    <div>
                      <div className="flex items-center gap-1.5 mb-1 justify-between">
                        <label className="block text-sm font-bold text-gray-900">Issue Description</label>
                        <button 
                          onClick={handleAiDiagnose}
                          disabled={isDiagnosing || !issueDescription.trim() || !vehicleInfo.trim()}
                          className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full transition-all ${
                            isDiagnosing 
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                              : (!issueDescription.trim() || !vehicleInfo.trim())
                                ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                                : 'bg-red-50 text-red-600 hover:bg-red-100'
                          }`}
                        >
                          {isDiagnosing ? (
                            <div className="w-3 h-3 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3" />
                          )}
                          AI Diagnose
                        </button>
                      </div>
                      <textarea 
                        value={issueDescription}
                        onChange={(e) => setIssueDescription(e.target.value)}
                        placeholder="Describe the problem (e.g. Flat tire, won't start)"
                        rows={3}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all resize-none"
                      />
                    </div>

                    <AnimatePresence>
                      {aiDiagnosis && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="bg-red-50/50 border border-red-100 rounded-2xl p-4 mt-2">
                             <div className="flex items-center gap-2 text-red-700 font-bold text-xs uppercase tracking-wider mb-3">
                              <Sparkles className="w-4 h-4" />
                              AI Preliminary Diagnosis
                            </div>
                            <div className="space-y-3">
                              <p className="text-sm text-gray-800 leading-relaxed">{aiDiagnosis.diagnosis}</p>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-1">Your Phone Number</label>
                      <input 
                        type="tel" 
                        value={userPhone}
                        onChange={(e) => setUserPhone(e.target.value)}
                        placeholder="e.g. +1 555-0198"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all"
                      />
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button 
                        onClick={() => setWizardStep(1)}
                        className="flex-1 px-4 py-4 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-all"
                      >
                        Back
                      </button>
                      <button 
                        onClick={() => {
                          const nearest = [...mechanics].filter(m => m.isAvailable !== false).sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance))[0];
                          if (nearest) {
                            setSelectedMechanic(nearest);
                            setShowBookingWizard(false);
                            setShowBookingConfirmation(true);
                          } else {
                            alert("No available mechanics nearby right now. Please try again later.");
                          }
                        }}
                        disabled={!vehicleInfo.trim() || !issueDescription.trim() || !userPhone.trim()}
                        className="flex-[2] py-4 bg-red-500 text-white font-bold rounded-xl shadow-lg shadow-red-500/20 transition-all disabled:bg-gray-300 disabled:shadow-none active:scale-[0.98] flex items-center justify-center gap-2"
                      >
                        <Search className="w-4 h-4" /> Find Mechanic
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Booking Confirmation Modal */}
      <AnimatePresence>
        {showBookingConfirmation && selectedMechanic && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900">Confirm Booking</h3>
                <button onClick={() => setShowBookingConfirmation(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                {/* Mechanic Summary */}
                <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-2xl">
                  <img 
                    src={selectedMechanic.image} 
                    alt={selectedMechanic.name} 
                    className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-sm" 
                    referrerPolicy="no-referrer"
                  />
                  <div>
                    <h4 className="font-bold text-gray-900">{selectedMechanic.name}</h4>
                    <p className="text-sm text-gray-500">{selectedMechanic.specialty}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                      <span className="text-xs font-bold">{selectedMechanic.rating}</span>
                    </div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-lg font-bold text-red-500">{selectedMechanic.price}</div>
                    <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Estimated Cost</div>
                  </div>
                </div>

                {/* Service Details */}
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-blue-50 p-2 rounded-lg mt-1">
                      <Car className="w-4 h-4 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Vehicle & Issue</p>
                      <p className="text-sm font-medium text-gray-900">{vehicleInfo}</p>
                      <p className="text-xs text-gray-700 mt-1">Service Type: 
                        {serviceType === 'general_maintenance' && ' General Maintenance'}
                        {serviceType === 'emergency_repair' && ' Emergency Repair'}
                        {serviceType === 'part_replacement' && ' Specific Part Replacement'}
                        {serviceType === 'diagnostics' && ' Inspection/Diagnostics'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">{issueDescription}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="bg-green-50 p-2 rounded-lg mt-1">
                      <MapPin className="w-4 h-4 text-green-500" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Service Location</p>
                      <p className="text-sm font-medium text-gray-900">Your current location</p>
                      <p className="text-xs text-gray-500 mt-1">Mechanic ETA: {selectedMechanic.eta}</p>
                    </div>
                  </div>

                  {bookingType === 'scheduled' && (
                    <div className="flex items-start gap-3">
                      <div className="bg-purple-50 p-2 rounded-lg mt-1">
                        <Calendar className="w-4 h-4 text-purple-500" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Scheduled For</p>
                        <p className="text-sm font-medium text-gray-900">{scheduledDate} at {scheduledTime}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 bg-gray-50 flex gap-3">
                <button 
                  onClick={() => setShowBookingConfirmation(false)}
                  className="flex-1 py-3 px-4 bg-white border border-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={processBooking}
                  className="flex-1 py-3 px-4 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
                >
                  Confirm & Request
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white shadow-sm z-20 px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-red-500 p-2 rounded-lg">
            <Wrench className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">MechRescue</h1>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={toggleRole}
            className="text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 py-1 px-3 rounded-full transition-colors"
          >
            {userRole === 'user' ? 'Switch to Mechanic' : 'Switch to User'}
          </button>
          <button onClick={logOut} className="text-gray-500 hover:text-gray-700 p-2">
            <LogOut className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden border-2 border-white shadow-sm">
            <img src={user.photoURL || "https://picsum.photos/seed/user/100/100"} alt="User" referrerPolicy="no-referrer" />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 relative flex flex-col md:flex-row overflow-hidden">
        
        {userRole === 'mechanic' ? (
          <div className="flex-1 bg-gray-50 overflow-y-auto p-4 md:p-8">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Mechanic Dashboard</h2>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">Available</span>
                    <button
                      onClick={() => handleToggleAvailability(user.uid, mechanics.find(m => m.id === user.uid)?.isAvailable)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${mechanics.find(m => m.id === user.uid)?.isAvailable !== false ? 'bg-green-500' : 'bg-gray-300'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${mechanics.find(m => m.id === user.uid)?.isAvailable !== false ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  <button 
                    onClick={() => setIsEditingProfile(!isEditingProfile)}
                    className="text-sm font-bold text-red-500 hover:text-red-600 flex items-center gap-1"
                  >
                    {isEditingProfile ? 'Cancel' : 'Edit Profile'}
                  </button>
                </div>
              </div>

              {/* Mechanic Profile Summary / Edit Form */}
              {isEditingProfile ? (
                <motion.form 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onSubmit={handleUpdateProfile}
                  className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 mb-8 space-y-4"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Full Name</label>
                      <input 
                        name="name"
                        defaultValue={mechanics.find(m => m.id === user.uid)?.name}
                        className="w-full bg-gray-50 border-transparent focus:bg-white focus:border-red-500 focus:ring-2 focus:ring-red-200 rounded-xl px-4 py-2 outline-none transition-all text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Specialty (e.g. Tire Service)</label>
                      <input 
                        name="specialty"
                        defaultValue={mechanics.find(m => m.id === user.uid)?.specialty}
                        className="w-full bg-gray-50 border-transparent focus:bg-white focus:border-red-500 focus:ring-2 focus:ring-red-200 rounded-xl px-4 py-2 outline-none transition-all text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Category</label>
                      <select 
                        name="category"
                        defaultValue={mechanics.find(m => m.id === user.uid)?.category || 'car'}
                        className="w-full bg-gray-50 border-transparent focus:bg-white focus:border-red-500 focus:ring-2 focus:ring-red-200 rounded-xl px-4 py-2 outline-none transition-all text-sm"
                      >
                        <option value="car">Car</option>
                        <option value="bike">Bike</option>
                        <option value="both">Both</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Price (e.g. $85/hr)</label>
                      <input 
                        name="price"
                        defaultValue={mechanics.find(m => m.id === user.uid)?.price}
                        className="w-full bg-gray-50 border-transparent focus:bg-white focus:border-red-500 focus:ring-2 focus:ring-red-200 rounded-xl px-4 py-2 outline-none transition-all text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Experience (e.g. 5 years)</label>
                      <input 
                        name="experience"
                        defaultValue={mechanics.find(m => m.id === user.uid)?.experience}
                        className="w-full bg-gray-50 border-transparent focus:bg-white focus:border-red-500 focus:ring-2 focus:ring-red-200 rounded-xl px-4 py-2 outline-none transition-all text-sm"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Bio</label>
                    <textarea 
                      name="bio"
                      defaultValue={mechanics.find(m => m.id === user.uid)?.bio}
                      className="w-full bg-gray-50 border-transparent focus:bg-white focus:border-red-500 focus:ring-2 focus:ring-red-200 rounded-xl px-4 py-2 outline-none transition-all text-sm h-24 resize-none"
                      required
                    />
                  </div>
                  <button 
                    type="submit"
                    className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-red-500/20"
                  >
                    Save Changes
                  </button>
                </motion.form>
              ) : (
                mechanics.find(m => m.id === user.uid) && (
                  <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 mb-8 flex items-center gap-4">
                    <img src={mechanics.find(m => m.id === user.uid)?.image} alt="Profile" className="w-16 h-16 rounded-full object-cover" referrerPolicy="no-referrer" />
                    <div className="flex-1">
                      <h3 className="font-bold text-gray-900">{mechanics.find(m => m.id === user.uid)?.name}</h3>
                      <p className="text-xs text-gray-500">{mechanics.find(m => m.id === user.uid)?.specialty}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                          mechanics.find(m => m.id === user.uid)?.category === 'car' ? 'bg-blue-100 text-blue-700' : 
                          mechanics.find(m => m.id === user.uid)?.category === 'bike' ? 'bg-purple-100 text-purple-700' : 
                          'bg-orange-100 text-orange-700'
                        }`}>
                          {mechanics.find(m => m.id === user.uid)?.category || 'General'} Specialist
                        </span>
                        <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">{mechanics.find(m => m.id === user.uid)?.price}</span>
                      </div>
                    </div>
                  </div>
                )
              )}
              
              {mechanicBookings.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 shadow-sm">
                  <Wrench className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900">No active requests</h3>
                  <p className="text-gray-500 mt-1">Waiting for customers to book your service.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {mechanicBookings.map((booking) => (
                    <div key={booking.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col sm:flex-row gap-6">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-semibold text-gray-900 text-lg">Service Request</div>
                          <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            booking.status === 'en_route' ? 'bg-blue-100 text-blue-800' : 
                            booking.status === 'arrived' ? 'bg-purple-100 text-purple-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {booking.status === 'en_route' ? 'En Route' : 
                             booking.status === 'arrived' ? 'Arrived' : 'Pending Acceptance'}
                          </div>
                        </div>
                        
                        <div className="bg-gray-50 p-4 rounded-xl mb-4 border border-gray-100">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold overflow-hidden">
                              {booking.userPhoto ? (
                                <img src={booking.userPhoto} alt={booking.userName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <span>{booking.userName?.charAt(0) || 'C'}</span>
                              )}
                            </div>
                            <div>
                              <div className="font-bold text-gray-900">{booking.userName || 'Customer'}</div>
                              <div className="text-xs text-gray-500">Customer ID: {booking.userId?.substring(0, 8)}...</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                            <div className="text-sm text-gray-600 flex items-center gap-2">
                              <Phone className="w-4 h-4 text-gray-400" />
                              {booking.userPhone || 'No phone provided'}
                            </div>
                            <div className="text-sm text-gray-600 flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-gray-400" />
                              {booking.location[0].toFixed(4)}, {booking.location[1].toFixed(4)}
                            </div>
                          </div>
                          
                          <div className="flex flex-wrap gap-2 mb-3">
                            <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              booking.bookingType === 'emergency' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {booking.bookingType === 'emergency' ? <AlertTriangle className="w-3 h-3 mr-1" /> : <Calendar className="w-3 h-3 mr-1" />}
                              {booking.bookingType || 'Standard'}
                            </div>
                            {booking.bookingType === 'scheduled' && (
                              <div className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-700">
                                <Clock className="w-3 h-3 mr-1" /> {booking.scheduledDate} @ {booking.scheduledTime}
                              </div>
                            )}
                          </div>

                          <div className="border-t border-gray-200 pt-3 mt-3">
                            <div className="text-sm font-semibold text-gray-900 mb-1">Vehicle Details</div>
                            <div className="text-sm text-gray-700 mb-2">{booking.vehicleInfo || 'Not specified'}</div>
                            
                            <div className="text-sm font-semibold text-gray-900 mb-1">Reported Issue</div>
                            <div className="text-sm text-gray-700">{booking.issueDescription || 'Not specified'}</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mb-4">
                          <div className="text-sm text-gray-500 flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            Requested: {new Date(booking.date).toLocaleTimeString()}
                          </div>
                          <button
                            onClick={() => { setBookingId(booking.id); setIsChatOpen(true); }}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-xl transition-colors flex items-center gap-2"
                          >
                            <MessageCircle className="w-4 h-4" /> Chat
                          </button>
                        </div>
                        
                        {booking.status === 'active' ? (
                          <button 
                            onClick={() => handleAcceptBooking(booking.id)}
                            className="w-full sm:w-auto bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-6 rounded-xl transition-colors"
                          >
                            Accept Request
                          </button>
                        ) : booking.status === 'en_route' ? (
                          <button 
                            onClick={() => handleArriveBooking(booking.id)}
                            className="w-full sm:w-auto bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-6 rounded-xl transition-colors"
                          >
                            Mark as Arrived
                          </button>
                        ) : booking.status === 'arrived' ? (
                          <button 
                            onClick={() => handleRequestPayment(booking.id)}
                            className="w-full sm:w-auto bg-yellow-500 hover:bg-yellow-600 text-white font-semibold py-2 px-6 rounded-xl transition-colors"
                          >
                            Request Payment
                          </button>
                        ) : booking.status === 'payment_pending' ? (
                          <div className="w-full sm:w-auto bg-gray-100 text-gray-600 font-semibold py-2 px-6 rounded-xl text-center">
                            Waiting for Customer Payment...
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Mechanic History Section */}
              <div className="mt-12 mb-6">
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <History className="w-5 h-5 text-gray-400" /> Past Services
                </h2>
              </div>

              {mechanicHistory.length === 0 ? (
                <div className="text-center py-8 bg-white/50 rounded-2xl border border-dashed border-gray-200">
                  <p className="text-sm text-gray-400">No completed services yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {mechanicHistory.map((booking) => (
                    <div key={booking.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-bold overflow-hidden">
                          {booking.userPhoto ? (
                            <img src={booking.userPhoto} alt={booking.userName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <span>{booking.userName?.charAt(0) || 'C'}</span>
                          )}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900 text-sm">{booking.userName || 'Customer'}</div>
                          <div className="text-[10px] text-gray-500">{new Date(booking.date).toLocaleDateString()} • {booking.vehicleInfo}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-green-600">Completed</div>
                        <div className="text-[10px] text-gray-400">{booking.mechanicPrice}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : currentTab === 'ai' ? (
          <div className="flex-1 flex flex-col bg-white overflow-hidden">
            <div className="p-6 border-b border-gray-100 bg-white sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-50 flex items-center justify-center text-red-500">
                  <Bot className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">AI Automotive Assistant</h1>
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Powered by Gemini AI</p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
              {aiMessages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <div className="w-16 h-16 rounded-3xl bg-white shadow-sm flex items-center justify-center text-red-500 mb-4">
                    <Sparkles className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">How can I help you today?</h3>
                  <p className="text-sm text-gray-500 max-w-xs">
                    Ask me anything about car maintenance, troubleshooting, or general vehicle questions.
                  </p>
                  <div className="grid grid-cols-1 gap-2 mt-6 w-full max-w-xs">
                    {['Why is my engine light on?', 'How often should I change oil?', 'Brake squeaking help'].map(q => (
                      <button 
                        key={q}
                        onClick={() => setAiInput(q)}
                        className="text-xs text-left px-4 py-3 bg-white border border-gray-100 rounded-xl hover:border-red-200 hover:bg-red-50 transition-all text-gray-700 font-medium"
                      >
                        "{q}"
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {aiMessages.map((msg, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm border ${
                    msg.role === 'user' 
                      ? 'bg-red-500 text-white border-red-400 rounded-tr-none' 
                      : 'bg-white text-gray-800 border-gray-100 rounded-tl-none'
                  }`}>
                    <div className="flex items-center gap-2 mb-1 opacity-70">
                      {msg.role === 'user' ? (
                        <UserIcon className="w-3 h-3" />
                      ) : (
                        <Bot className="w-3 h-3" />
                      )}
                      <span className="text-[10px] font-bold uppercase tracking-wider">
                        {msg.role === 'user' ? 'You' : 'AI Assistant'}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  </div>
                </motion.div>
              ))}
              {isAiThinking && (
                <div className="flex justify-start">
                  <div className="bg-white p-4 rounded-2xl rounded-tl-none shadow-sm border border-gray-100 flex items-center gap-2">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-white border-t border-gray-100">
              <div className="flex gap-2">
                <input 
                  type="text"
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAiChat()}
                  placeholder="Ask about your vehicle..."
                  className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all text-sm"
                />
                <button 
                  onClick={handleAiChat}
                  disabled={!aiInput.trim() || isAiThinking}
                  className="w-12 h-12 rounded-xl bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-500/30 hover:bg-red-600 disabled:bg-gray-300 disabled:shadow-none transition-all"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        ) : currentTab === 'map' ? (
          <>
            {/* Map Section */}
            <div className="flex-1 relative z-0 h-[50vh] md:h-full">
          <MapContainer center={DEFAULT_LOCATION} zoom={14} zoomControl={false} className="w-full h-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            
            {/* User Location */}
            <Marker position={userLocation} icon={userIcon}>
              <Popup>Your Location</Popup>
            </Marker>

            {/* Mechanics Locations */}
            {bookingState === 'idle' && filteredMechanics.map(mech => (
              <Marker 
                key={mech.id} 
                position={mech.location} 
                icon={getMechanicIcon(mech.category)}
                eventHandlers={{ click: () => setSelectedMechanic(mech) }}
              >
                <Popup>
                  <div className="font-semibold">{mech.name}</div>
                  <div className="text-xs text-gray-500">{mech.specialty}</div>
                  <div className="text-[10px] font-bold uppercase text-red-500 mt-1">{mech.category || 'General'}</div>
                </Popup>
              </Marker>
            ))}

            {/* Fit to Mechanics Bounds */}
            {bookingState === 'idle' && filteredMechanics.length > 0 && (
              <MapUpdater bounds={L.latLngBounds(filteredMechanics.map(m => m.location))} />
            )}

            {/* Live Tracking Marker */}
            {bookingState === 'tracking' && liveLocation && (
              <>
                <Marker position={liveLocation} icon={getMechanicIcon(selectedMechanic?.category)} />
                <MapUpdater center={liveLocation} />
              </>
            )}

            {/* Manual Centering */}
            {mapCenter && <MapUpdater center={mapCenter} />}
          </MapContainer>

          {/* Map Overlay Gradient (Mobile) */}
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-gray-50 to-transparent z-[400] md:hidden pointer-events-none" />
          
          {/* Map Controls */}
          <div className="absolute top-4 right-4 flex flex-col gap-2 z-[400]">
            <button 
              onClick={() => {
                setMapCenter([...userLocation]);
                setTimeout(() => setMapCenter(null), 100);
              }}
              className="w-10 h-10 bg-white rounded-xl shadow-lg flex items-center justify-center text-gray-700 hover:text-red-500 transition-all"
              title="Center on My Location"
            >
              <Navigation className="w-5 h-5" />
            </button>
            {filteredMechanics.length > 0 && (
              <button 
                onClick={() => {
                  const firstMechLoc = filteredMechanics[0].location;
                  setMapCenter([...firstMechLoc]);
                  setTimeout(() => setMapCenter(null), 100);
                }}
                className="w-10 h-10 bg-white rounded-xl shadow-lg flex items-center justify-center text-gray-700 hover:text-red-500 transition-all"
                title="Show All Mechanics"
              >
                <Users className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Quick Actions */}
          {userRole === 'user' && bookingState === 'idle' && !selectedMechanic && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[400] flex gap-3 w-[90%] md:w-auto justify-center">
              <button 
                onClick={() => {
                  setShowBookingWizard(true);
                  setWizardStep(1);
                  setBookingType('scheduled');
                }}
                className="bg-white text-gray-900 border border-gray-200 px-5 py-4 rounded-full shadow-xl flex items-center gap-2 font-bold text-sm transition-transform hover:scale-105 active:scale-95 whitespace-nowrap"
              >
                <Calendar className="w-5 h-5 text-blue-500" />
                Book Service
              </button>
              <button 
                onClick={() => {
                  setShowBookingWizard(true);
                  setWizardStep(1);
                  setBookingType('emergency');
                }}
                className="bg-red-600 hover:bg-red-700 text-white px-5 py-4 rounded-full shadow-2xl shadow-red-600/40 flex items-center gap-2 font-bold text-sm transition-transform hover:scale-105 active:scale-95 whitespace-nowrap"
              >
                <AlertTriangle className="w-5 h-5 animate-pulse" />
                Emergency SOS
              </button>
            </div>
          )}
        </div>

        {/* Sidebar / Bottom Sheet */}
        <div className="w-full md:w-96 bg-gray-50 z-20 flex flex-col h-[50vh] md:h-full shadow-[0_-4px_20px_rgba(0,0,0,0.05)] md:shadow-[-4px_0_20px_rgba(0,0,0,0.05)]">
          
          <AnimatePresence mode="wait">
            {/* STATE 1: List of Mechanics */}
            {bookingState === 'idle' && !selectedMechanic && (
              <motion.div 
                key="list"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 overflow-y-auto p-4"
              >
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Nearby Mechanics</h2>
                  <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button 
                      onClick={() => setMechanicCategoryFilter('all')}
                      className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${mechanicCategoryFilter === 'all' ? 'bg-white text-red-500 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      All
                    </button>
                    <button 
                      onClick={() => setMechanicCategoryFilter('car')}
                      className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${mechanicCategoryFilter === 'car' ? 'bg-white text-blue-500 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Cars
                    </button>
                    <button 
                      onClick={() => setMechanicCategoryFilter('bike')}
                      className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${mechanicCategoryFilter === 'bike' ? 'bg-white text-purple-500 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Bikes
                    </button>
                  </div>
                </div>

                <div className="mb-4 space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input 
                      type="text"
                      placeholder="Search by specialty (e.g. Engine, Tires)..."
                      value={specialtyFilter}
                      onChange={(e) => setSpecialtyFilter(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div 
                      onClick={() => setAvailabilityFilter(!availabilityFilter)}
                      className={`w-8 h-4 rounded-full transition-colors relative ${availabilityFilter ? 'bg-green-500' : 'bg-gray-300'}`}
                    >
                      <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${availabilityFilter ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                    <span className="text-xs font-medium text-gray-600 group-hover:text-gray-900 transition-colors">Show only available mechanics</span>
                  </label>
                </div>
                {filteredMechanics.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    {mechanics.length === 0 ? 'Loading mechanics...' : `No ${mechanicCategoryFilter} mechanics nearby.`}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredMechanics.map(mech => (
                      <div 
                        key={mech.id}
                        onClick={() => setSelectedMechanic(mech)}
                        className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 cursor-pointer hover:border-red-200 hover:shadow-md transition-all flex gap-4"
                      >
                        <img src={mech.image} alt={mech.name} className="w-16 h-16 rounded-xl object-cover" referrerPolicy="no-referrer" />
                        <div className="flex-1">
                          <div className="flex justify-between items-start">
                            <h3 className="font-semibold text-gray-900">{mech.name}</h3>
                            <div className="flex items-center text-sm font-medium text-gray-700">
                              <Star className="w-4 h-4 text-yellow-400 fill-yellow-400 mr-1" />
                              {mech.rating}
                            </div>
                          </div>
                          <p className="text-sm text-gray-500 mb-2">{mech.specialty}</p>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                              mech.category === 'car' ? 'bg-blue-100 text-blue-700' : 
                              mech.category === 'bike' ? 'bg-purple-100 text-purple-700' : 
                              'bg-orange-100 text-orange-700'
                            }`}>
                              {mech.category || 'General'}
                            </span>
                            {aiDiagnosis && (mech.category === aiDiagnosis.recommendedCategory || mech.category === 'both') && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-red-100 text-red-700 flex items-center gap-1">
                                <Sparkles className="w-2.5 h-2.5" />
                                Recommended
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500 font-medium">
                            <span className="flex items-center"><MapPin className="w-3 h-3 mr-1" /> {mech.distance}</span>
                            <span className="flex items-center"><Clock className="w-3 h-3 mr-1" /> {mech.eta}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* STATE 2: Mechanic Details */}
            {bookingState === 'idle' && selectedMechanic && (
              <motion.div 
                key="details"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="flex-1 flex flex-col bg-white"
              >
                <div className="p-4 border-b border-gray-100 flex items-center gap-3">
                  <button onClick={() => setSelectedMechanic(null)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                    <ArrowLeft className="w-5 h-5 text-gray-600" />
                  </button>
                  <h2 className="text-lg font-semibold text-gray-900">Mechanic Details</h2>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="flex flex-col items-center text-center mb-6">
                    <img src={selectedMechanic.image} alt={selectedMechanic.name} className="w-24 h-24 rounded-full object-cover shadow-md mb-4 border-4 border-white" referrerPolicy="no-referrer" />
                    <h2 className="text-2xl font-bold text-gray-900">{selectedMechanic.name}</h2>
                    <p className="text-gray-500 mb-2">{selectedMechanic.specialty}</p>
                    <span className={`text-xs px-2 py-1 rounded-full font-bold uppercase tracking-wider ${
                      selectedMechanic.category === 'car' ? 'bg-blue-100 text-blue-700' : 
                      selectedMechanic.category === 'bike' ? 'bg-purple-100 text-purple-700' : 
                      'bg-orange-100 text-orange-700'
                    }`}>
                      {selectedMechanic.category || 'General'} Specialist
                    </span>
                    
                    <div className="flex items-center gap-4 mt-4">
                      <div className="flex flex-col items-center">
                        <div className="flex items-center font-bold text-gray-900"><Star className="w-4 h-4 text-yellow-400 fill-yellow-400 mr-1" /> {selectedMechanic.rating}</div>
                        <div className="text-xs text-gray-500">{selectedMechanic.reviews} reviews</div>
                      </div>
                      <div className="w-px h-8 bg-gray-200" />
                      <div className="flex flex-col items-center">
                        <div className="font-bold text-gray-900">{selectedMechanic.experience}</div>
                        <div className="text-xs text-gray-500">Experience</div>
                      </div>
                      <div className="w-px h-8 bg-gray-200" />
                      <div className="flex flex-col items-center">
                        <div className="font-bold text-gray-900">{selectedMechanic.price}</div>
                        <div className="text-xs text-gray-500">Rate</div>
                      </div>
                    </div>
                  </div>

                  <div className="mb-6">
                    <h3 className="font-semibold text-gray-900 mb-2">About</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {selectedMechanic.bio}
                    </p>
                  </div>

                  <div className="space-y-4 mb-6">
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${selectedMechanic.isAvailable !== false ? 'bg-green-500' : 'bg-gray-400'}`} />
                        <span className="text-sm font-medium text-gray-700">{selectedMechanic.isAvailable !== false ? 'Available for Service' : 'Currently Unavailable'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                      <ShieldCheck className="w-5 h-5 text-green-500" />
                      <div className="text-sm text-gray-700">Verified Professional & Background Checked</div>
                    </div>
                    <a 
                      href={`tel:${selectedMechanic.phone}`}
                      className="flex items-center justify-between p-3 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <Phone className="w-5 h-5 text-blue-500" />
                        <div className="text-sm font-semibold text-blue-700">{selectedMechanic.phone}</div>
                      </div>
                      <span className="text-xs font-bold text-blue-500 uppercase tracking-wider group-hover:translate-x-1 transition-transform">Call Now</span>
                    </a>
                  </div>

                  {/* Booking Form */}
                  <div className="space-y-4 mb-2">
                    <h3 className="font-semibold text-gray-900">Service Details</h3>
                    
                    {/* Booking Type Toggle */}
                    <div className="flex p-1 bg-gray-100 rounded-xl mb-4">
                      <button
                        onClick={() => setBookingType('emergency')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${bookingType === 'emergency' ? 'bg-red-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        <AlertTriangle className="w-4 h-4" /> Emergency
                      </button>
                      <button
                        onClick={() => setBookingType('scheduled')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${bookingType === 'scheduled' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        <Calendar className="w-4 h-4" /> Scheduled
                      </button>
                    </div>

                    {bookingType === 'scheduled' && (
                      <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Date</label>
                          <input 
                            type="date" 
                            value={scheduledDate}
                            onChange={(e) => setScheduledDate(e.target.value)}
                            min={new Date().toISOString().split('T')[0]}
                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Time</label>
                          <input 
                            type="time" 
                            value={scheduledTime}
                            onChange={(e) => setScheduledTime(e.target.value)}
                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Make & Model</label>
                      <input 
                        type="text" 
                        value={vehicleInfo}
                        onChange={(e) => setVehicleInfo(e.target.value)}
                        placeholder="e.g. 2018 Toyota Camry"
                        className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Type of Service</label>
                      <select 
                        value={serviceType}
                        onChange={(e) => setServiceType(e.target.value)}
                        className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all text-sm"
                      >
                        <option value="general_maintenance">General Maintenance (Oil change, tune-up)</option>
                        <option value="emergency_repair">Emergency Repair (Breakdown, won't start)</option>
                        <option value="part_replacement">Specific Part Replacement (Brakes, Battery, etc.)</option>
                        <option value="diagnostics">Inspection / Diagnostics (Strange noises, check engine light)</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium text-gray-700">Issue Description</label>
                        <button 
                          onClick={handleAiDiagnose}
                          disabled={isDiagnosing || !issueDescription.trim() || !vehicleInfo.trim()}
                          className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full transition-all ${
                            isDiagnosing 
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                              : (!issueDescription.trim() || !vehicleInfo.trim())
                                ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                                : 'bg-red-50 text-red-600 hover:bg-red-100'
                          }`}
                        >
                          {isDiagnosing ? (
                            <div className="w-3 h-3 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                          ) : (
                            <Sparkles className="w-3 h-3" />
                          )}
                          AI Diagnose
                        </button>
                      </div>
                      <textarea 
                        value={issueDescription}
                        onChange={(e) => setIssueDescription(e.target.value)}
                        placeholder="Describe the problem (e.g. Flat tire, won't start)"
                        rows={3}
                        className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all resize-none"
                      />
                    </div>

                    {/* AI Diagnosis Result */}
                    <AnimatePresence>
                      {aiDiagnosis && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="bg-red-50/50 border border-red-100 rounded-2xl p-4 mt-2">
                            <div className="flex items-center gap-2 text-red-700 font-bold text-xs uppercase tracking-wider mb-3">
                              <Sparkles className="w-4 h-4" />
                              AI Preliminary Diagnosis
                            </div>
                            
                            <div className="space-y-3">
                              <div>
                                <p className="text-sm text-gray-800 leading-relaxed">
                                  {aiDiagnosis.diagnosis}
                                </p>
                              </div>
                              
                              <div className="flex flex-wrap gap-2">
                                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase ${
                                  aiDiagnosis.severity === 'high' ? 'bg-red-100 text-red-700' :
                                  aiDiagnosis.severity === 'medium' ? 'bg-orange-100 text-orange-700' :
                                  'bg-green-100 text-green-700'
                                }`}>
                                  <AlertTriangle className="w-3 h-3" />
                                  Severity: {aiDiagnosis.severity}
                                </div>
                                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-100 text-blue-700 text-[10px] font-bold uppercase">
                                  <DollarSign className="w-3 h-3" />
                                  Est. Cost: {aiDiagnosis.estimatedCost}
                                </div>
                              </div>

                              <div className="bg-white/50 rounded-xl p-3 border border-red-100/50">
                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Recommended Next Steps</p>
                                <ul className="space-y-1.5">
                                  {aiDiagnosis.nextSteps.map((step, i) => (
                                    <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                                      <CheckCircle2 className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                                      {step}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Your Phone Number</label>
                      <input 
                        type="tel" 
                        value={userPhone}
                        onChange={(e) => setUserPhone(e.target.value)}
                        placeholder="e.g. +1 555-0198"
                        className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-gray-100 bg-white">
                    <button 
                      onClick={handleBook}
                      disabled={
                        selectedMechanic.isAvailable === false || 
                        !vehicleInfo.trim() || 
                        !issueDescription.trim() || 
                        !userPhone.trim() ||
                        (bookingType === 'scheduled' && (!scheduledDate || !scheduledTime))
                      }
                      className={`w-full font-semibold py-4 rounded-xl shadow-lg transition-all active:scale-[0.98] ${
                        selectedMechanic.isAvailable !== false && 
                        vehicleInfo.trim() && 
                        issueDescription.trim() && 
                        userPhone.trim() &&
                        (bookingType === 'emergency' || (scheduledDate && scheduledTime))
                          ? (bookingType === 'emergency' ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/30' : 'bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/30')
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                      }`}
                    >
                      {selectedMechanic.isAvailable === false 
                        ? 'Currently Unavailable' 
                        : (!vehicleInfo.trim() || !issueDescription.trim() || !userPhone.trim() 
                          ? 'Fill details to request' 
                          : (bookingType === 'scheduled' && (!scheduledDate || !scheduledTime) 
                            ? 'Select date & time' 
                            : (bookingType === 'emergency' ? 'Request Emergency Service' : 'Schedule Service')))}
                    </button>
                  </div>
              </motion.div>
            )}

            {/* STATE 3: Confirming */}
            {bookingState === 'confirming' && (
              <motion.div 
                key="confirming"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white"
              >
                <div className="w-16 h-16 border-4 border-red-100 border-t-red-500 rounded-full animate-spin mb-6" />
                <h2 className="text-xl font-bold text-gray-900 mb-2">Confirming Request...</h2>
                <p className="text-gray-500">Contacting {selectedMechanic?.name} to accept your service request.</p>
              </motion.div>
            )}

            {/* STATE 4: Tracking */}
            {bookingState === 'tracking' && selectedMechanic && (
              <motion.div 
                key="tracking"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex-1 flex flex-col bg-white"
              >
                <div className="bg-red-500 text-white p-6 rounded-b-3xl shadow-md">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold">
                      {mechanicStatus === 'arrived' || mechanicStatus === 'payment_pending' ? 'Mechanic has arrived!' : 'Mechanic is on the way!'}
                    </h2>
                    <div className="bg-white/20 px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm">
                      {mechanicStatus === 'arrived' || mechanicStatus === 'payment_pending' ? 'Arrived' : `ETA: ${selectedMechanic.eta}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <img src={selectedMechanic.image} alt={selectedMechanic.name} className="w-12 h-12 rounded-full border-2 border-white" referrerPolicy="no-referrer" />
                    <div>
                      <div className="font-semibold">{selectedMechanic.name}</div>
                      <div className="text-red-100 text-sm flex items-center gap-3 mt-1">
                        <span className="flex items-center"><Navigation className="w-3 h-3 mr-1" /> {mechanicStatus === 'arrived' || mechanicStatus === 'payment_pending' ? '0 km' : selectedMechanic.distance}</span>
                        <span className="flex items-center"><Star className="w-3 h-3 mr-1" /> {selectedMechanic.rating}</span>
                        <span className="font-medium">{selectedMechanic.price}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 ml-auto">
                      <button onClick={() => setIsChatOpen(true)} className="w-10 h-10 bg-white text-red-500 rounded-full flex items-center justify-center shadow-sm hover:bg-red-50 transition-colors">
                        <MessageCircle className="w-5 h-5" />
                      </button>
                      <a href={`tel:${selectedMechanic.phone}`} className="w-10 h-10 bg-white text-red-500 rounded-full flex items-center justify-center shadow-sm hover:bg-red-50 transition-colors">
                        <Phone className="w-5 h-5" />
                      </a>
                    </div>
                  </div>
                </div>

                <div className="flex-1 p-6 flex flex-col justify-center">
                  <div className="relative pl-6 border-l-2 border-gray-200 space-y-8">
                    <div className="relative">
                      <div className="absolute -left-[31px] bg-green-500 rounded-full p-1">
                        <CheckCircle2 className="w-4 h-4 text-white" />
                      </div>
                      <h3 className="font-semibold text-gray-900">Request Accepted</h3>
                      <p className="text-sm text-gray-500">Booking #{bookingId}</p>
                    </div>
                    <div className="relative">
                      <div className={`absolute -left-[31px] rounded-full p-1 border-4 border-white shadow-sm ${mechanicStatus === 'arrived' || mechanicStatus === 'payment_pending' ? 'bg-green-500' : 'bg-red-500'}`}>
                        {mechanicStatus === 'arrived' || mechanicStatus === 'payment_pending' ? <CheckCircle2 className="w-4 h-4 text-white" /> : <div className="w-4 h-4" />}
                      </div>
                      <h3 className={`font-semibold ${mechanicStatus === 'arrived' || mechanicStatus === 'payment_pending' ? 'text-gray-900' : 'text-red-500'}`}>Mechanic En Route</h3>
                      <p className="text-sm text-gray-500">Live tracking active</p>
                    </div>
                    <div className={`relative ${mechanicStatus === 'arrived' || mechanicStatus === 'payment_pending' ? 'opacity-100' : 'opacity-40'}`}>
                      <div className={`absolute -left-[29px] rounded-full w-4 h-4 border-4 border-white ${mechanicStatus === 'arrived' || mechanicStatus === 'payment_pending' ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <h3 className="font-semibold text-gray-900">Arrived</h3>
                      <p className="text-sm text-gray-500">{mechanicStatus === 'arrived' || mechanicStatus === 'payment_pending' ? 'Mechanic is at your location' : 'Pending'}</p>
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-gray-100">
                  <button 
                    onClick={mechanicStatus === 'arrived' || mechanicStatus === 'payment_pending' ? handlePayment : handleCancel}
                    className={`w-full font-semibold py-4 rounded-xl transition-colors ${
                      mechanicStatus === 'arrived' || mechanicStatus === 'payment_pending'
                        ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg shadow-green-500/30' 
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                  >
                    {mechanicStatus === 'arrived' || mechanicStatus === 'payment_pending' ? `Pay Mechanic (${selectedMechanic.price})` : 'Cancel Request'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        {/* Chat UI */}
        <AnimatePresence>
          {isChatOpen && (
            <motion.div
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              className="fixed inset-0 sm:inset-auto sm:right-4 sm:bottom-20 sm:w-96 sm:h-[600px] bg-white sm:rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden"
            >
              {/* Chat Header */}
              <div className="bg-red-500 text-white p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MessageCircle className="w-5 h-5" />
                  <h3 className="font-bold text-lg">Chat</h3>
                </div>
                <button onClick={() => setIsChatOpen(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                {messages.length === 0 ? (
                  <div className="text-center text-gray-500 mt-10">
                    <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-20" />
                    <p>No messages yet.</p>
                    <p className="text-sm">Start the conversation!</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMe = msg.senderId === user?.uid;
                    return (
                      <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${isMe ? 'bg-red-500 text-white rounded-tr-sm' : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm shadow-sm'}`}>
                          <p className="text-sm">{msg.text}</p>
                          <p className={`text-[10px] mt-1 ${isMe ? 'text-red-100' : 'text-gray-400'}`}>
                            {msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Sending...'}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input */}
              <div className="p-4 bg-white border-t border-gray-100">
                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 bg-gray-100 border-transparent focus:bg-white focus:border-red-500 focus:ring-2 focus:ring-red-200 rounded-xl px-4 py-2 outline-none transition-all"
                  />
                  <button
                    type="submit"
                    disabled={!newMessage.trim()}
                    className="bg-red-500 hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white p-2 rounded-xl transition-colors flex items-center justify-center w-10 h-10"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </>
        ) : currentTab === 'mechanics' ? (
          /* Mechanics List Section */
          <div className="flex-1 bg-gray-50 overflow-y-auto p-4 md:p-8">
            <div className="max-w-3xl mx-auto">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
                <h2 className="text-2xl font-bold text-gray-900">Available Mechanics</h2>
                <div className="flex bg-white p-1 rounded-xl shadow-sm border border-gray-100">
                  <button 
                    onClick={() => setMechanicCategoryFilter('all')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${mechanicCategoryFilter === 'all' ? 'bg-red-500 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                  >
                    All
                  </button>
                  <button 
                    onClick={() => setMechanicCategoryFilter('car')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${mechanicCategoryFilter === 'car' ? 'bg-red-500 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                  >
                    Cars
                  </button>
                  <button 
                    onClick={() => setMechanicCategoryFilter('bike')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${mechanicCategoryFilter === 'bike' ? 'bg-red-500 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                  >
                    Bikes
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {mechanics
                  .filter(m => m.isAvailable !== false)
                  .filter(m => mechanicCategoryFilter === 'all' || m.category === mechanicCategoryFilter || m.category === 'both')
                  .map((mech) => (
                  <div 
                    key={mech.id} 
                    className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-4 hover:border-red-200 transition-colors cursor-pointer"
                    onClick={() => { setSelectedMechanic(mech); setCurrentTab('map'); }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-red-50">
                        <img src={mech.image} alt={mech.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h3 className="font-bold text-gray-900">{mech.name}</h3>
                          <div className="flex items-center gap-1 text-yellow-500">
                            <Star className="w-3 h-3 fill-current" />
                            <span className="text-xs font-bold">{mech.rating}</span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500">{mech.specialty}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">{mech.experience}</span>
                          <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-bold">{mech.distance}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                            mech.category === 'car' ? 'bg-blue-100 text-blue-700' : 
                            mech.category === 'bike' ? 'bg-purple-100 text-purple-700' : 
                            'bg-orange-100 text-orange-700'
                          }`}>
                            {mech.category || 'General'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                      <div className="text-sm font-bold text-red-600">{mech.price}</div>
                      <button className="text-xs font-bold text-gray-400 hover:text-red-500 uppercase tracking-wider">View on Map</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Bookings Section */
          <div className="flex-1 bg-gray-50 overflow-y-auto p-4 md:p-8">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">My Bookings</h2>
                <button 
                  onClick={seedSampleMechanics}
                  className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 py-1.5 px-3 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <Wrench className="w-3.5 h-3.5" /> Seed Sample Mechanics
                </button>
              </div>
              
              {bookingHistory.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 shadow-sm">
                  <History className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900">No bookings yet</h3>
                  <p className="text-gray-500 mt-1">Your service requests will appear here.</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Active Bookings */}
                  {bookingHistory.filter(b => b.status !== 'completed' && b.status !== 'cancelled').length > 0 && (
                    <div>
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Active & Upcoming</h3>
                      <div className="space-y-4">
                        {bookingHistory.filter(b => b.status !== 'completed' && b.status !== 'cancelled').map((booking, index) => (
                          <div key={index} className="bg-white p-6 rounded-2xl shadow-sm border-l-4 border-l-red-500 border-y border-r border-gray-100 flex flex-col sm:flex-row gap-6">
                            <div className="flex items-center gap-4 sm:w-1/3">
                              <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center font-bold text-lg overflow-hidden">
                                {booking.mechanicImage ? (
                                  <img src={booking.mechanicImage} alt={booking.mechanicName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                  <Wrench className="w-6 h-6" />
                                )}
                              </div>
                              <div>
                                <div className="font-semibold text-gray-900">{booking.mechanicName || 'Unknown Mechanic'}</div>
                                <div className="text-xs text-gray-500 font-mono mt-0.5">ID: {booking.id?.substring(0, 8)}...</div>
                              </div>
                            </div>
                            
                            <div className="flex-1">
                              <div className="grid grid-cols-2 gap-4 mb-3">
                                <div>
                                  <div className="text-sm text-gray-500 flex items-center gap-1"><Clock className="w-4 h-4" /> Date</div>
                                  <div className="font-medium text-gray-900">
                                    {booking.bookingType === 'scheduled' ? booking.scheduledDate : new Date(booking.date).toLocaleDateString()}
                                  </div>
                                  <div className="text-sm text-gray-500">
                                    {booking.bookingType === 'scheduled' ? booking.scheduledTime : new Date(booking.date).toLocaleTimeString()}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-sm text-gray-500 flex items-center gap-1"><ShieldCheck className="w-4 h-4" /> Status</div>
                                  <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${
                                    booking.status === 'active' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'
                                  }`}>
                                    {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2 mt-4">
                                <button 
                                  onClick={() => { setBookingId(booking.id); setBookingState('tracking'); setCurrentTab('map'); }}
                                  className="flex-1 bg-red-500 hover:bg-red-600 text-white text-xs font-bold py-2 rounded-lg transition-colors"
                                >
                                  Track Live
                                </button>
                                <button 
                                  onClick={() => handleCancelBooking(booking.id)}
                                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold py-2 rounded-lg transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Past Bookings */}
                  {bookingHistory.filter(b => b.status === 'completed' || b.status === 'cancelled').length > 0 && (
                    <div>
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Past Services</h3>
                      <div className="space-y-4">
                        {bookingHistory.filter(b => b.status === 'completed' || b.status === 'cancelled').map((booking, index) => (
                          <div key={index} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col sm:flex-row gap-6 opacity-80">
                            <div className="flex items-center gap-4 sm:w-1/3">
                              <div className="w-12 h-12 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center font-bold text-lg overflow-hidden">
                                {booking.mechanicImage ? (
                                  <img src={booking.mechanicImage} alt={booking.mechanicName} className="w-full h-full object-cover grayscale" referrerPolicy="no-referrer" />
                                ) : (
                                  <Wrench className="w-6 h-6" />
                                )}
                              </div>
                              <div>
                                <div className="font-semibold text-gray-900">{booking.mechanicName || 'Unknown Mechanic'}</div>
                                <div className="text-xs text-gray-500 font-mono mt-0.5">ID: {booking.id?.substring(0, 8)}...</div>
                              </div>
                            </div>
                            
                            <div className="flex-1">
                              <div className="grid grid-cols-2 gap-4 mb-3">
                                <div>
                                  <div className="text-sm text-gray-500 flex items-center gap-1"><Clock className="w-4 h-4" /> Date</div>
                                  <div className="font-medium text-gray-900">
                                    {booking.bookingType === 'scheduled' ? booking.scheduledDate : new Date(booking.date).toLocaleDateString()}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-sm text-gray-500 flex items-center gap-1"><ShieldCheck className="w-4 h-4" /> Status</div>
                                  <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${
                                    booking.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                  }`}>
                                    {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Navigation (Mobile) / Side Navigation (Desktop could be added, but keeping it simple at bottom for now) */}
      {userRole === 'user' && (
        <div className="bg-white border-t border-gray-200 flex justify-around p-2 pb-safe z-30">
          <button 
            onClick={() => setCurrentTab('map')}
            className={`flex flex-col items-center p-2 w-24 rounded-xl transition-colors ${currentTab === 'map' ? 'text-red-500 bg-red-50' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <MapIcon className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Map</span>
          </button>
          <button 
            onClick={() => setCurrentTab('mechanics')}
            className={`flex flex-col items-center p-2 w-24 rounded-xl transition-colors ${currentTab === 'mechanics' ? 'text-red-500 bg-red-50' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <Users className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Mechanics</span>
          </button>
          <button 
            onClick={() => setCurrentTab('bookings')}
            className={`flex flex-col items-center p-2 w-24 rounded-xl transition-colors ${currentTab === 'bookings' ? 'text-red-500 bg-red-50' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <History className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Bookings</span>
          </button>
          <button 
            onClick={() => setCurrentTab('ai')}
            className={`flex flex-col items-center p-2 w-24 rounded-xl transition-colors ${currentTab === 'ai' ? 'text-red-500 bg-red-50' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <Sparkles className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-bold uppercase tracking-wider">AI Help</span>
          </button>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
