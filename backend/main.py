from typing import List, Optional
from enum import Enum
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types
import json


client = genai.Client()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Tool(Enum):
    """
    Model for available tools that can be used by the AI
    """
    SEARCH = "search"

    def __str__(self):
        return self.value


class AnswerQuestionRequest(BaseModel):
    """
    Model for the request of the answer_question endpoint
    """
    question: str
    tools: Optional[List[Tool]] = []


async def answer_question_generator(
    question: str,
    tools: Optional[List[Tool]] = None
):
    """
    Answer question using Google Gemini API and stream the response

    Args:
        question (str): The question to be answered
    """
    tools_to_use = []
    for tool in tools or []:
        if tool == Tool.SEARCH:
            search_tool = types.Tool(
                google_search=types.GoogleSearch()
            )
            tools_to_use.append(search_tool)

    response = await client.aio.models.generate_content_stream(
        model="gemini-2.5-flash",
        contents=question,
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                include_thoughts=True,
            ),
            tools=tools_to_use,
        )
    )

    async for chunk in response:
        for part in chunk.candidates[0].content.parts:
            if not part.text:
                continue
            elif part.thought:
                data = {
                    "is_thought": True,
                    "content": part.text,
                    "is_complete": False,
                }
            elif part.text:
                data = {
                    "is_thought": False,
                    "content": part.text,
                    "is_complete": False,
                }

            yield f"data: {json.dumps(data)}\n\n"

    yield f"data: {json.dumps({'is_thought': False, 'content': '', 'is_complete': True})}\n\n"



@app.post("/answer_question")
async def answer_question(request: AnswerQuestionRequest):
    """
    Endpoint that accepts a question and returns a streaming response
    """
    return StreamingResponse(
        answer_question_generator(request.question, request.tools),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )
