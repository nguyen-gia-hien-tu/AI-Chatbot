import React, { useState, useRef, useEffect } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import ReactMarkdown from 'react-markdown';

function App() {
    const [question, setQuestion] = useState('');
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(false);
    const abortControllerRef = useRef(null);
    const bufferRef = useRef('');
    const typingIntervalRef = useRef(null);
    const messagesEndRef = useRef(null);

    // Scroll to bottom when new messages arrive
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Character-by-character typing effect
    const typeText = (newText) => {
        // Simply append the new text to the buffer for processing
        bufferRef.current += newText;

        // Start typing if not already typing
        if (!typingIntervalRef.current) {
            startTyping();
        }
    };

    const startTyping = () => {
        if (typingIntervalRef.current) return; // Already typing

        typingIntervalRef.current = setInterval(() => {
            if (bufferRef.current.length > 0) {
                const nextChar = bufferRef.current.charAt(0);
                bufferRef.current = bufferRef.current.substring(1);

                // Update the last message (assistant's response) with new character
                setMessages(prev => {
                    const updated = [...prev];
                    if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
                        updated[updated.length - 1] = {
                            ...updated[updated.length - 1],
                            content: updated[updated.length - 1].content + nextChar
                        };
                    }
                    return updated;
                });
            } else {
                // Buffer is empty, stop typing animation
                clearInterval(typingIntervalRef.current);
                typingIntervalRef.current = null;
            }
        }, 20); // 50ms between characters - adjust typing speed
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!question.trim()) return;

        const userMessage = question.trim();
        setQuestion(''); // Clear input immediately

        // Add user message to chat
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

        // Add empty assistant message that will be filled during streaming
        setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }]);

        // Reset states
        setLoading(true);
        bufferRef.current = '';

        // Clear any ongoing typing animation
        if (typingIntervalRef.current) {
            clearInterval(typingIntervalRef.current);
            typingIntervalRef.current = null;
        }

        // Abort any existing request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        // Create new AbortController for this request
        abortControllerRef.current = new AbortController();

        try {
            await fetchEventSource('http://localhost:8000/answer_question', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ question: userMessage }),
                signal: abortControllerRef.current.signal,
                onopen(res) {
                    if (res.ok && res.status === 200) {
                        // Connection successful
                    } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
                        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                    }
                },
                onmessage(event) {
                    try {
                        const data = JSON.parse(event.data);

                        if (data.content && data.content.length > 0) {
                            typeText(data.content);
                        }

                        if (data.is_complete) {
                            setLoading(false);
                            // Mark the last message as no longer streaming
                            setMessages(prev => {
                                const updated = [...prev];
                                if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
                                    updated[updated.length - 1] = {
                                        ...updated[updated.length - 1],
                                        streaming: false
                                    };
                                }
                                return updated;
                            });
                        }
                    } catch (error) {
                        console.error('Error parsing SSE data:', error);
                        setLoading(false);
                    }
                },
                onclose() {
                    setLoading(false);
                },
                onerror(err) {
                    console.error("EventSource failed:", err);
                    setLoading(false);
                    throw err;
                }
            });
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Fetch event source error:', error);
            }
            setLoading(false);
        }
    };

    // Cleanup on component unmount
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            if (typingIntervalRef.current) {
                clearInterval(typingIntervalRef.current);
            }
        };
    }, []);

    return (
        <div style={{
            maxWidth: '800px',
            margin: '0 auto',
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'Arial, sans-serif'
        }}>
            {/* Header */}
            <div style={{
                padding: '20px',
                borderBottom: '1px solid #ddd',
                backgroundColor: '#f8f9fa'
            }}>
                <h1 style={{ margin: 0, fontSize: '24px', color: '#333' }}>AI Chat Assistant</h1>
            </div>

            {/* Messages Container */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '20px',
                backgroundColor: '#ffffff',
                borderRadius: '30px',
                margin: '10px'
            }}>
                {messages.length === 0 && (
                    <div style={{
                        textAlign: 'center',
                        color: '#666',
                        marginTop: '50px',
                        fontSize: '18px'
                    }}>
                        👋 Hello! Ask me anything to get started.
                    </div>
                )}

                {messages.map((message, index) => (
                    <div key={index} style={{
                        marginBottom: '20px',
                        display: 'flex',
                        justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start'
                    }}>
                        <div style={{
                            maxWidth: '70%',
                            padding: '12px 16px',
                            borderRadius: '18px',
                            backgroundColor: message.role === 'user' ? '#007bff' : '#f1f3f4',
                            color: message.role === 'user' ? 'white' : '#333',
                            wordWrap: 'break-word',
                            position: 'relative'
                        }}>
                            {message.role === 'user' ? (
                                // User messages - plain text
                                <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
                            ) : (
                                // Assistant messages - render as markdown
                                <div style={{
                                    fontFamily: 'inherit',
                                    lineHeight: '1.5'
                                }}>
                                    <ReactMarkdown
                                        components={{
                                            // Style markdown elements
                                            h1: ({ node, ...props }) => <h1 style={{ fontSize: '1.5em', margin: '0.5em 0', fontWeight: 'bold' }} {...props} />,
                                            h2: ({ node, ...props }) => <h2 style={{ fontSize: '1.3em', margin: '0.4em 0', fontWeight: 'bold' }} {...props} />,
                                            h3: ({ node, ...props }) => <h3 style={{ fontSize: '1.1em', margin: '0.3em 0', fontWeight: 'bold' }} {...props} />,
                                            p: ({ node, ...props }) => <p style={{ margin: '0.5em 0', lineHeight: '1.5' }} {...props} />,
                                            code: ({ node, inline, ...props }) =>
                                                inline ?
                                                    <code style={{
                                                        backgroundColor: '#e9ecef',
                                                        padding: '2px 4px',
                                                        borderRadius: '3px',
                                                        fontSize: '0.9em',
                                                        color: '#d63384'
                                                    }} {...props} /> :
                                                    <code style={{
                                                        display: 'block',
                                                        backgroundColor: '#f8f9fa',
                                                        padding: '10px',
                                                        borderRadius: '5px',
                                                        fontSize: '0.9em',
                                                        overflowX: 'auto',
                                                        margin: '0.5em 0',
                                                        border: '1px solid #e9ecef'
                                                    }} {...props} />,
                                            pre: ({ node, ...props }) => <pre style={{ margin: 0 }} {...props} />,
                                            ul: ({ node, ...props }) => <ul style={{ margin: '0.5em 0', paddingLeft: '1.5em' }} {...props} />,
                                            ol: ({ node, ...props }) => <ol style={{ margin: '0.5em 0', paddingLeft: '1.5em' }} {...props} />,
                                            li: ({ node, ...props }) => <li style={{ margin: '0.2em 0' }} {...props} />,
                                            blockquote: ({ node, ...props }) => <blockquote style={{
                                                borderLeft: '4px solid #dee2e6',
                                                paddingLeft: '1em',
                                                margin: '0.5em 0',
                                                fontStyle: 'italic',
                                                color: '#6c757d'
                                            }} {...props} />,
                                            strong: ({ node, ...props }) => <strong style={{ fontWeight: 'bold' }} {...props} />,
                                            em: ({ node, ...props }) => <em style={{ fontStyle: 'italic' }} {...props} />,
                                            a: ({ node, ...props }) => <a style={{ color: '#0066cc', textDecoration: 'underline' }} {...props} />
                                        }}
                                    >
                                        {message.content}
                                    </ReactMarkdown>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Form */}
            <div style={{
                padding: '20px',
                borderTop: '1px solid #ddd',
                backgroundColor: '#f8f9fa'
            }}>
                <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px' }}>
                    <input
                        type="text"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder="Type your message..."
                        style={{
                            flex: 1,
                            padding: '12px 16px',
                            fontSize: '16px',
                            border: '1px solid #ddd',
                            borderRadius: '25px',
                            outline: 'none',
                            backgroundColor: 'white'
                        }}
                        disabled={loading}
                    />
                    <button
                        type="submit"
                        disabled={loading || !question.trim()}
                        style={{
                            padding: '12px 24px',
                            fontSize: '16px',
                            backgroundColor: loading || !question.trim() ? '#ccc' : '#007bff',
                            color: 'white',
                            border: 'none',
                            borderRadius: '25px',
                            cursor: loading || !question.trim() ? 'not-allowed' : 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        {loading ? '...' : 'Send'}
                    </button>
                </form>
            </div>

            <style jsx>{`
                body {
                margin: 0;
                padding: 0;
                }
            `}</style>
        </div>
    );
}

export default App;
