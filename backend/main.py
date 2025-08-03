from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
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


class AnswerQuestionRequest(BaseModel):
    """
    Model for the request of the answer_question endpoint
    """
    question: str


async def answer_question_generator(question: str):
    """
    Answer question using Google Gemini API and stream the response

    Args:
        question (str): The question to be answered
    """
    response = await client.aio.models.generate_content_stream(
        model="gemini-2.5-flash",
        contents=question,
    )

    async for chunk in response:
        data = {
            "content": chunk.text,
            "is_complete": False,
        }
        yield f"data: {json.dumps(data)}\n\n"

    yield f"data: {json.dumps({'content': '', 'is_complete': True})}\n\n"



@app.post("/answer_question")
async def answer_question(request: AnswerQuestionRequest):
    """
    Endpoint that accepts a question and returns a streaming response
    """
    question = request.question
    return StreamingResponse(
        answer_question_generator(question), 
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )
