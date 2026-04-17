import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import path from 'path';
import Stripe from 'stripe';
import { Server } from 'socket.io';

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required. Please set it in the AI Studio settings.');
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

const USER_LOCATION = [40.7128, -74.0060];

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  const PORT = 3000;

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join', (userId) => {
      socket.join(userId);
      console.log(`User ${userId} joined room`);
    });

    socket.on('send_notification', ({ targetUserId, title, body, type }) => {
      io.to(targetUserId).emit('notification', { title, body, type });
      console.log(`Notification sent to ${targetUserId}: ${title}`);
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  app.use(express.json());

  // --- API Routes ---
  app.post('/api/create-checkout-session', async (req, res) => {
    try {
      const stripe = getStripe();
      const { bookingId, mechanicName, priceString } = req.body;
      
      let amount = 8500; // default $85.00
      const match = priceString?.match(/\d+/);
      if (match) {
        amount = parseInt(match[0], 10) * 100;
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Mechanic Service by ${mechanicName}`,
                description: `Booking ID: ${bookingId}`,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${req.headers.origin}?payment_success=true&booking_id=${bookingId}`,
        cancel_url: `${req.headers.origin}?payment_canceled=true`,
      });

      res.json({ url: session.url });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
