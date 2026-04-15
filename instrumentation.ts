import { startAutoEmbedRecovery } from '@/services/embedding/autoEmbedQueue';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    startAutoEmbedRecovery();
  }
}
