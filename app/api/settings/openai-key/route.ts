import { NextRequest, NextResponse } from 'next/server';
import {
  getEnvLocalPath,
  isValidOpenAiKey,
  maskOpenAiKey,
  readStoredOpenAiKey,
  writeOpenAiKeyToEnvLocal,
} from '@/services/storage/envLocalServer';

export const runtime = 'nodejs';

function buildResponse(key: string | null) {
  const configured = isValidOpenAiKey(key);
  return {
    configured,
    maskedKey: configured ? maskOpenAiKey(key) : null,
    envPath: getEnvLocalPath(),
  };
}

export async function GET() {
  try {
    const storedKey = await readStoredOpenAiKey();
    return NextResponse.json(buildResponse(storedKey));
  } catch (error) {
    return NextResponse.json(
      {
        configured: false,
        error: error instanceof Error ? error.message : 'Failed to read .env.local',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const key = typeof body?.key === 'string' ? body.key.trim() : '';

    if (!isValidOpenAiKey(key)) {
      return NextResponse.json(
        { error: 'Invalid OpenAI API key format.' },
        { status: 400 }
      );
    }

    await writeOpenAiKeyToEnvLocal(key);
    process.env.OPENAI_API_KEY = key;

    return NextResponse.json(buildResponse(key));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to save OpenAI API key',
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    await writeOpenAiKeyToEnvLocal(null);
    delete process.env.OPENAI_API_KEY;
    return NextResponse.json(buildResponse(null));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to remove OpenAI API key',
      },
      { status: 500 }
    );
  }
}
