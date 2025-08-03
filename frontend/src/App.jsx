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
    // Track the current mode to handle mixed content correctly
    const currentModeRef = useRef(null); // 'thought' or 'content'

    // Scroll to bottom when new messages arrive
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    // Only scroll to bottom when messages array length changes or when streaming
    const shouldAutoScroll = useRef(true);

    useEffect(() => {
        if (shouldAutoScroll.current) {
            scrollToBottom();
        }
    }, [messages.length, messages[messages.length - 1]?.streaming]);

    // Toggle thought visibility
    const toggleThought = (messageIndex) => {
        setMessages(prev => {
            const updated = [...prev];
            updated[messageIndex] = {
                ...updated[messageIndex],
                thoughtExpanded: !updated[messageIndex].thoughtExpanded
            };
            return updated;
        });
    };

    // Character-by-character typing effect
    const typeText = (newText, isThought = false) => {
        // Simply append the new text to the buffer for processing
        if (isThought) {
            bufferRef.current += `THOUGHT:${newText}`;
        } else {
            bufferRef.current += `CONTENT:${newText}`;
        }

        // Start typing if not already typing
        if (!typingIntervalRef.current) {
            startTyping();
        }
    };

    const startTyping = () => {
        if (typingIntervalRef.current) return; // Already typing

        typingIntervalRef.current = setInterval(() => {
            if (bufferRef.current.length > 0) {
                // Check if we're processing thought or content
                let isThought = false;
                let nextChar = '';

                if (bufferRef.current.startsWith('THOUGHT:')) {
                    isThought = true;
                    currentModeRef.current = 'thought';
                    bufferRef.current = bufferRef.current.substring(8); // Remove 'THOUGHT:' prefix
                    if (bufferRef.current.length > 0) {
                        nextChar = bufferRef.current.charAt(0);
                        bufferRef.current = bufferRef.current.substring(1);
                    }
                } else if (bufferRef.current.startsWith('CONTENT:')) {
                    isThought = false;
                    currentModeRef.current = 'content';
                    bufferRef.current = bufferRef.current.substring(8); // Remove 'CONTENT:' prefix
                    if (bufferRef.current.length > 0) {
                        nextChar = bufferRef.current.charAt(0);
                        bufferRef.current = bufferRef.current.substring(1);
                    }
                } else if (bufferRef.current.length > 0) {
                    // Continue with the current mode for characters without prefix
                    isThought = currentModeRef.current === 'thought';
                    nextChar = bufferRef.current.charAt(0);
                    bufferRef.current = bufferRef.current.substring(1);
                }

                if (nextChar) {
                    // Update the last message (assistant's response) with new character
                    setMessages(prev => {
                        const updated = [...prev];
                        if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
                            const lastMessage = updated[updated.length - 1];
                            const fieldToUpdate = isThought ? 'thought' : 'content';
                            updated[updated.length - 1] = {
                                ...lastMessage,
                                [fieldToUpdate]: lastMessage[fieldToUpdate] + nextChar,
                                // Auto-expand thought section while streaming thought content
                                thoughtExpanded: isThought ? true : lastMessage.thoughtExpanded,
                                // Show thought section as soon as thought content starts streaming
                                showThought: isThought ? true : lastMessage.showThought
                            };
                        }
                        return updated;
                    });
                }
            } else {
                // Buffer is empty, stop typing animation
                clearInterval(typingIntervalRef.current);
                typingIntervalRef.current = null;
            }
        }, 20); // 20ms between characters - adjust typing speed
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!question.trim()) return;

        const userMessage = question.trim();
        setQuestion(''); // Clear input immediately

        // Add user message to chat
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

        // Add empty assistant message that will be filled during streaming
        setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            thought: '',
            streaming: true,
            showThought: false
        }]);

        // Reset states
        setLoading(true);
        bufferRef.current = '';
        currentModeRef.current = null; // Reset mode tracking

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
                            if (data.thought) {
                                typeText(data.content, true); // This is thought content
                            } else {
                                typeText(data.content, false); // This is regular content
                            }
                        }

                        if (data.is_complete) {
                            setLoading(false);
                            // Mark the last message as no longer streaming and show thought if it exists
                            setMessages(prev => {
                                const updated = [...prev];
                                if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
                                    updated[updated.length - 1] = {
                                        ...updated[updated.length - 1],
                                        streaming: false,
                                        showThought: updated[updated.length - 1].thought.length > 0,
                                        thoughtExpanded: true // Keep expanded after completion
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
                                // Assistant messages - render as markdown with thought section
                                <div>
                                    {/* Thought Process Section */}
                                    {message.showThought && (
                                        <div style={{
                                            marginBottom: '12px',
                                            border: '1px solid #e0e0e0',
                                            borderRadius: '8px',
                                            backgroundColor: '#fafafa'
                                        }}>
                                            {/* Thought Header - Clickable */}
                                            <div
                                                onClick={() => toggleThought(index)}
                                                style={{
                                                    padding: '8px 12px',
                                                    backgroundColor: '#f0f0f0',
                                                    borderRadius: '8px 8px 0 0',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    fontSize: '0.9em',
                                                    fontWeight: '500',
                                                    color: '#666',
                                                    borderBottom: message.thoughtExpanded ? '1px solid #e0e0e0' : 'none'
                                                }}
                                            >
                                                <span style={{
                                                    transform: message.thoughtExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                                    transition: 'transform 0.2s ease',
                                                    fontSize: '12px'
                                                }}>
                                                    ▶
                                                </span>
                                                🤔 Thought Process
                                            </div>

                                            {/* Thought Content - Collapsible */}
                                            {message.thoughtExpanded && (
                                                <div style={{
                                                    padding: '12px',
                                                    fontSize: '0.9em',
                                                    color: '#555',
                                                    fontStyle: 'italic',
                                                    lineHeight: '1.4',
                                                    backgroundColor: '#fafafa'
                                                }}>
                                                    {message.streaming ? (
                                                        // Show raw text while streaming to avoid broken markdown
                                                        <div style={{ whiteSpace: 'pre-wrap' }}>
                                                            {message.thought}
                                                        </div>
                                                    ) : (
                                                        // Show rendered markdown after streaming is complete
                                                        <ReactMarkdown
                                                            components={{
                                                                p: ({ node, ...props }) => <p style={{ margin: '0.3em 0', lineHeight: '1.4' }} {...props} />,
                                                                h1: ({ node, ...props }) => <h1 style={{ fontSize: '1.2em', margin: '0.4em 0', fontWeight: 'bold', color: '#444' }} {...props} />,
                                                                h2: ({ node, ...props }) => <h2 style={{ fontSize: '1.1em', margin: '0.3em 0', fontWeight: 'bold', color: '#444' }} {...props} />,
                                                                h3: ({ node, ...props }) => <h3 style={{ fontSize: '1.0em', margin: '0.2em 0', fontWeight: 'bold', color: '#444' }} {...props} />,
                                                                strong: ({ node, ...props }) => <strong style={{ fontWeight: 'bold', color: '#333' }} {...props} />,
                                                                em: ({ node, ...props }) => <em style={{ fontStyle: 'italic' }} {...props} />,
                                                                code: ({ node, inline, ...props }) =>
                                                                    inline ?
                                                                        <code style={{
                                                                            backgroundColor: '#e9ecef',
                                                                            padding: '1px 3px',
                                                                            borderRadius: '2px',
                                                                            fontSize: '0.85em',
                                                                            color: '#c7254e'
                                                                        }} {...props} /> :
                                                                        <code style={{
                                                                            display: 'block',
                                                                            backgroundColor: '#f8f9fa',
                                                                            padding: '8px',
                                                                            borderRadius: '4px',
                                                                            fontSize: '0.85em',
                                                                            margin: '0.3em 0',
                                                                            border: '1px solid #e9ecef',
                                                                            color: '#333'
                                                                        }} {...props} />,
                                                                ul: ({ node, ...props }) => <ul style={{ margin: '0.3em 0', paddingLeft: '1.2em' }} {...props} />,
                                                                ol: ({ node, ...props }) => <ol style={{ margin: '0.3em 0', paddingLeft: '1.2em' }} {...props} />,
                                                                li: ({ node, ...props }) => <li style={{ margin: '0.1em 0' }} {...props} />,
                                                                blockquote: ({ node, ...props }) => <blockquote style={{
                                                                    borderLeft: '3px solid #ccc',
                                                                    paddingLeft: '0.8em',
                                                                    margin: '0.3em 0',
                                                                    fontStyle: 'italic',
                                                                    color: '#666'
                                                                }} {...props} />
                                                            }}
                                                        >
                                                            {message.thought}
                                                        </ReactMarkdown>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Main Response Content */}
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
