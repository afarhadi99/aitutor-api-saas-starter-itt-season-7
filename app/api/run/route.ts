// app/api/run/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getUser, getTeamForUser } from '@/lib/db/queries';
import { checkMessageLimit, incrementMessageCount, saveWorkflowHistory } from '@/lib/db/utils';

export async function POST(req: NextRequest) {
  try {
    const { website, company } = await req.json();

    if (!website || !company) {
      return NextResponse.json(
        { error: 'Missing website or company parameter' },
        { status: 400 }
      );
    }

    // Get the authenticated user.
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      );
    }

    // Get the team details for the user.
    const team = await getTeamForUser(user.id);
    if (!team) {
      return NextResponse.json(
        { error: 'Team not found' },
        { status: 404 }
      );
    }

    // Check the team's monthly message limit.
    const { withinLimit, remainingMessages } = await checkMessageLimit(team.id);
    if (!withinLimit) {
      return NextResponse.json(
        {
          error:
            'Monthly message limit reached. Upgrade your plan for unlimited messages.',
        },
        { status: 403 }
      );
    }

    // Validate required environment variables.
    if (!process.env.WORKFLOW_ID || !process.env.AITUTOR_API_KEY) {
      return NextResponse.json(
        { error: 'Missing environment variables: WORKFLOW_ID or AITUTOR_API_KEY' },
        { status: 500 }
      );
    }

    // Call the external AI Tutor API's run endpoint with website and company parameters
    const response = await fetch(
      `https://aitutor-api.vercel.app/api/v1/run/${process.env.WORKFLOW_ID}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.AITUTOR_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          website: website,
          company: company
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || 'Error generating content' },
        { status: response.status }
      );
    }

    // MOVED: Increment the team's message count AFTER successful API call
    await incrementMessageCount(team.id, 1);

    // Save workflow history - store the input as a JSON string with website and company
    const inputData = JSON.stringify({ website, company });
    await saveWorkflowHistory(
      team.id, 
      user.id, 
      inputData, 
      data.result || JSON.stringify(data)
    );

    return NextResponse.json(data, { status: 200 });
  } catch (error: any) {
    console.error('API Route Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
