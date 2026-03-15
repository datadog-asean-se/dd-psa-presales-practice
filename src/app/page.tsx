"use client";

import React, { useState, useRef, useEffect } from 'react';
import { datadogRum } from '@datadog/browser-rum';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  RefreshCw, 
  ChevronRight, 
  User, 
  Bot, 
  LayoutDashboard, 
  Target, 
  ShieldAlert, 
  TrendingUp,
  Sparkles,
  Globe,
  Check,
  Download,
  Flag,
  BrainCircuit,
  Users2,
  ArrowRight,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { EXERCISES, Message, Exercise, LANGUAGES, Language, AI_MODELS, AIModel } from '../types';
import { cn } from '../lib/utils';
import { streamGeminiChat } from '../services/chatClient';

export default function App() {
  const [teamName, setTeamName] = useState('');
  const [teamNameDraft, setTeamNameDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentExercise, setCurrentExercise] = useState<Exercise | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(LANGUAGES[0]);
  const [selectedModel, setSelectedModel] = useState<AIModel>(AI_MODELS[0]);
  const [isThinkingEnabled, setIsThinkingEnabled] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialise Datadog RUM once on mount.
  // allowedTracingUrls enables APM–RUM correlation: the Browser SDK injects
  // Datadog/W3C trace-context headers into matching requests so they appear as
  // linked frontend resources inside backend APM traces.
  // https://docs.datadoghq.com/tracing/other_telemetry/rum?tab=browserrum#setup-rum
  useEffect(() => {
    datadogRum.init({
      applicationId: process.env.NEXT_PUBLIC_DD_RUM_APP_ID!,
      clientToken: process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN!,
      site: 'datadoghq.com',
      service: 'datadog-presales-practice-simulator',
      env: 'prod',
      sessionSampleRate: 100,
      sessionReplaySampleRate: 100,
      trackBfcacheViews: true,
      trackResources: true,
      trackLongTasks: true,
      trackUserInteractions: true,
      defaultPrivacyLevel: 'allow',
      // Inject tracing headers into same-origin /api/* requests so each chat
      // fetch is linked to its backend APM trace in the Datadog UI.
      allowedTracingUrls: [
        (url: string) => url.startsWith(`${window.location.origin}/api/`),
      ],
    });
  }, []);

  // Tag the RUM session with the team name whenever it is set so that
  // RUM sessions and LLM traces can be filtered by team.
  useEffect(() => {
    if (teamName) {
      datadogRum.setGlobalContextProperty('team_name', teamName);
      // Identify the RUM user session with the team name so sessions are
      // queryable by usr.id / usr.name in the RUM Explorer and dashboards.
      // https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/advanced_configuration/#user-session
      datadogRum.setUser({
        id: teamName,
        name: teamName,
      });
    }
  }, [teamName]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Returns the active RUM session ID for APM / LLMObs correlation.
  // https://docs.datadoghq.com/real_user_monitoring/correlate_with_other_telemetry/llm_observability/
  const getRumSessionId = (): string | undefined =>
    datadogRum.getInternalContext()?.session_id ?? undefined;

  const handleStartExercise = async (exercise: Exercise) => {
    setCurrentExercise(exercise);
    setIsLoading(true);
    setIsEnded(false);
    
    const initialMessage: Message = {
      role: 'user',
      text: exercise.isQuiz 
        ? `I want to start the coaching quiz: ${exercise.title}. ${exercise.description}. Please ask me the first open-ended question to test my knowledge. Respond in ${selectedLanguage.name}.`
        : `I want to start the exercise: ${exercise.title}. ${exercise.description}. Please start the meeting simulation. Respond in ${selectedLanguage.name}.`
    };
    
    setMessages([]);
    
    try {
      let fullResponse = '';
      setMessages([{ role: 'model', text: '' }]);
      
      await streamGeminiChat(
        [initialMessage], 
        (chunk) => {
          fullResponse += chunk;
          setMessages([{ role: 'model', text: fullResponse }]);
        },
        exercise.id, 
        selectedLanguage.name,
        selectedModel.id,
        isThinkingEnabled,
        teamName,
        getRumSessionId()
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error starting exercise. Please try again.';
      setMessages([{ role: 'model', text: `⚠️ ${msg}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { role: 'user', text: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      let fullResponse = '';
      setMessages(prev => [...prev, { role: 'model', text: '' }]);
      
      await streamGeminiChat(
        newMessages, 
        (chunk) => {
          fullResponse += chunk;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'model', text: fullResponse };
            return updated;
          });
        },
        currentExercise?.id, 
        selectedLanguage.name,
        selectedModel.id,
        isThinkingEnabled,
        teamName,
        getRumSessionId()
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Sorry, I encountered an error. Please try again.';
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'model', text: `⚠️ ${msg}` };
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resetSession = () => {
    setMessages([]);
    setCurrentExercise(null);
    setInput('');
    setIsEnded(false);
  };

  const handleEndExercise = async () => {
    if (isLoading || isEnded) return;
    setIsEnded(true);
    setIsLoading(true);

    const endMsg: Message = { role: 'user', text: 'I am ending the exercise now. Please provide the final debrief.' };
    const newMessages = [...messages, endMsg];
    setMessages(newMessages);

    try {
      let fullResponse = '';
      setMessages(prev => [...prev, { role: 'model', text: '' }]);
      
      await streamGeminiChat(
        newMessages, 
        (chunk) => {
          fullResponse += chunk;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'model', text: fullResponse };
            return updated;
          });
        },
        currentExercise?.id, 
        selectedLanguage.name,
        selectedModel.id,
        isThinkingEnabled,
        teamName,
        getRumSessionId(),
        true
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Sorry, I encountered an error generating the debrief.';
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'model', text: `⚠️ ${msg}` };
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = () => {
    if (messages.length === 0) return;

    const content = messages.map(m => {
      const role = m.role === 'user' ? 'You' : 'AI';
      return `### ${role}\n${m.text}\n`;
    }).join('\n');

    const header = `# ${currentExercise?.title}\nTeam: ${teamName}\nLanguage: ${selectedLanguage.name}\nModel: ${selectedModel.name}\nDate: ${new Date().toLocaleString()}\n\n`;
    
    const blob = new Blob(['\uFEFF' + header + content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentExercise?.id}-export-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getExerciseIcon = (id: string) => {
    switch (id) {
      case 'objective1': return <LayoutDashboard className="w-5 h-5" />;
      case 'objective2': return <ShieldAlert className="w-5 h-5" />;
      case 'techfit': return <Target className="w-5 h-5" />;
      case 'valueselling': return <TrendingUp className="w-5 h-5" />;
      default: return <Sparkles className="w-5 h-5" />;
    }
  };

  return (
    <div className="min-h-screen bg-[#111] text-white font-sans selection:bg-[#632CA6] selection:text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#191919]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#632CA6] rounded-lg flex items-center justify-center shadow-lg shadow-[#632CA6]/20">
              <Sparkles className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">Datadog Presales Practice</h1>
              <p className="text-xs text-white/50 font-mono uppercase tracking-widest">
                {process.env.NEXT_PUBLIC_DD_VERSION ? `v${process.env.NEXT_PUBLIC_DD_VERSION}` : 'DPN Simulator v1.0'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {teamName && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#632CA6]/20 rounded-full border border-[#632CA6]/30 text-xs text-[#a78bfa] font-semibold">
                <Users2 className="w-3 h-3" />
                {teamName}
              </div>
            )}
            {currentExercise && (
              <>
                {currentExercise.isQuiz && (
                  <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[#632CA6]/20 rounded-full border border-[#632CA6]/30 text-xs text-[#a78bfa] font-semibold">
                    <Target className="w-3 h-3" />
                    Coaching Quiz
                  </div>
                )}
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10 text-xs text-white/60">
                  <Bot className="w-3 h-3" />
                  {selectedModel.name}
                </div>
                {selectedModel.supportsThinking && isThinkingEnabled && (
                  <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[#632CA6]/20 rounded-full border border-[#632CA6]/30 text-xs text-[#a78bfa] font-semibold">
                    <BrainCircuit className="w-3 h-3" />
                    Thinking On
                  </div>
                )}
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10 text-xs text-white/60">
                  <Globe className="w-3 h-3" />
                  {selectedLanguage.name}
                </div>
                <button 
                  onClick={handleEndExercise}
                  disabled={messages.length === 0 || isEnded || isLoading}
                  className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors bg-white/5 px-3 py-1.5 rounded-full border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Flag className="w-4 h-4" />
                  End & Debrief
                </button>
                <button 
                  onClick={handleExport}
                  disabled={messages.length === 0}
                  className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors bg-white/5 px-3 py-1.5 rounded-full border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
                <button 
                  onClick={resetSession}
                  className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors bg-white/5 px-3 py-1.5 rounded-full border border-white/10"
                >
                  <RefreshCw className="w-4 h-4" />
                  Reset
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* ── Step 1: Team name input ── */}
        {!teamName ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md"
            >
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-[#632CA6] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-[#632CA6]/20">
                  <Users2 className="text-white w-8 h-8" />
                </div>
                <h2 className="text-3xl font-bold mb-3">Welcome</h2>
                <p className="text-white/60 text-lg">Enter your team name to start practicing</p>
              </div>

              <div className="bg-[#191919] border border-white/10 rounded-2xl p-6 space-y-4">
                <div>
                  <label className="block text-xs text-white/40 mb-2 font-mono uppercase tracking-widest">
                    Team Name
                  </label>
                  <input
                    type="text"
                    value={teamNameDraft}
                    onChange={(e) => setTeamNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && teamNameDraft.trim()) {
                        setTeamName(teamNameDraft.trim());
                      }
                    }}
                    placeholder="e.g. Team Awesome"
                    autoFocus
                    className="w-full bg-[#111] border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-[#632CA6] focus:ring-1 focus:ring-[#632CA6] transition-all placeholder:text-white/20 text-white"
                  />
                </div>
                <button
                  onClick={() => {
                    if (teamNameDraft.trim()) setTeamName(teamNameDraft.trim());
                  }}
                  disabled={!teamNameDraft.trim()}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-[#632CA6] hover:bg-[#7742E6] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-semibold transition-all shadow-lg shadow-[#632CA6]/20"
                >
                  Start Practice
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </div>

        /* ── Step 2: Exercise selection ── */
        ) : !currentExercise ? (
          <div className="max-w-4xl mx-auto">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-12"
            >
              <h2 className="text-4xl font-bold mb-4 bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                Master the Art of Presales
              </h2>
              <p className="text-white/60 text-lg max-w-2xl mx-auto mb-8">
                Select your language and a scenario to practice your discovery, qualification, and value selling skills.
              </p>

              {/* Language Selection */}
              <div className="flex flex-col items-center gap-3 mb-6">
                <p className="text-sm text-white/40 font-mono uppercase tracking-widest">Select Language</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => setSelectedLanguage(lang)}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl border transition-all text-sm",
                        selectedLanguage.code === lang.code 
                          ? "bg-[#632CA6] border-[#632CA6] text-white shadow-lg shadow-[#632CA6]/20" 
                          : "bg-white/5 border-white/10 text-white/60 hover:border-white/20 hover:text-white"
                      )}
                    >
                      <span>{lang.flag}</span>
                      <span>{lang.name}</span>
                      {selectedLanguage.code === lang.code && <Check className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Model Selection */}
              <div className="flex flex-col items-center gap-3 mb-12">
                <p className="text-sm text-white/40 font-mono uppercase tracking-widest">Select AI Model</p>
                <div className="flex flex-col items-center gap-4">
                  <div className="flex flex-wrap justify-center gap-2">
                    {AI_MODELS.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => {
                          setSelectedModel(model);
                          if (!model.supportsThinking) {
                            setIsThinkingEnabled(false);
                          }
                        }}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2 rounded-xl border transition-all text-sm",
                          selectedModel.id === model.id 
                            ? "bg-[#632CA6] border-[#632CA6] text-white shadow-lg shadow-[#632CA6]/20" 
                            : "bg-white/5 border-white/10 text-white/60 hover:border-white/20 hover:text-white"
                        )}
                      >
                        <span>{model.name}</span>
                        {selectedModel.id === model.id && <Check className="w-3 h-3" />}
                      </button>
                    ))}
                  </div>
                  
                  {/* Thinking Toggle */}
                  <AnimatePresence>
                    {selectedModel.supportsThinking && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-3 bg-[#191919] border border-white/10 rounded-xl px-4 py-2"
                      >
                        <BrainCircuit className={cn("w-4 h-4", isThinkingEnabled ? "text-[#a78bfa]" : "text-white/40")} />
                        <span className="text-sm text-white/80">Enable Deep Thinking</span>
                        <button
                          onClick={() => setIsThinkingEnabled(!isThinkingEnabled)}
                          className={cn(
                            "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none",
                            isThinkingEnabled ? "bg-[#632CA6]" : "bg-white/20"
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block h-3 w-3 transform rounded-full bg-white transition-transform",
                              isThinkingEnabled ? "translate-x-5" : "translate-x-1"
                            )}
                          />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {EXERCISES.map((ex, idx) => (
                <motion.button
                  key={ex.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  onClick={() => handleStartExercise(ex)}
                  className="group relative p-6 bg-[#191919] border border-white/10 rounded-2xl text-left hover:border-[#632CA6]/50 transition-all hover:shadow-2xl hover:shadow-[#632CA6]/10"
                >
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-white/5 rounded-xl group-hover:bg-[#632CA6]/20 group-hover:text-[#7742E6] transition-colors">
                      {getExerciseIcon(ex.id)}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg mb-1 group-hover:text-white transition-colors">{ex.title}</h3>
                      <p className="text-sm text-white/50 leading-relaxed">{ex.description}</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-white/20 group-hover:text-white group-hover:translate-x-1 transition-all" />
                  </div>
                </motion.button>
              ))}
            </div>
          </div>

        /* ── Step 3: Chat ── */
        ) : (
          <div className="flex flex-col h-[calc(100vh-12rem)] max-w-4xl mx-auto bg-[#191919] border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
              <AnimatePresence initial={false}>
                {messages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex gap-4 max-w-[85%]",
                      msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                    )}
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                      msg.role === 'user' ? "bg-white/10" : "bg-[#632CA6]"
                    )}>
                      {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                    </div>
                    <div className={cn(
                      "p-4 rounded-2xl text-sm leading-relaxed min-w-[50px]",
                      msg.role === 'user' 
                        ? "bg-white/5 border border-white/10 text-white" 
                        : "bg-[#222] border border-white/5 text-white/90 shadow-lg"
                    )}>
                      <div className="markdown-body prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown>{msg.text || '...'}</ReactMarkdown>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {isLoading && messages[messages.length - 1]?.role === 'user' && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-4 max-w-[85%] mr-auto"
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border",
                    isThinkingEnabled ? "bg-[#a78bfa]/20 border-[#a78bfa]/30" : "bg-[#632CA6]/20 border-[#632CA6]/30"
                  )}>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    >
                      {isThinkingEnabled ? (
                        <BrainCircuit className="w-4 h-4 text-[#a78bfa]" />
                      ) : (
                        <RefreshCw className="w-4 h-4 text-[#632CA6]" />
                      )}
                    </motion.div>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#222] border border-white/5 flex items-center gap-3 shadow-lg">
                    <div className="flex gap-1.5">
                      <motion.div
                        className={cn("w-1.5 h-1.5 rounded-full", isThinkingEnabled ? "bg-[#a78bfa]" : "bg-[#632CA6]")}
                        animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0 }}
                      />
                      <motion.div
                        className={cn("w-1.5 h-1.5 rounded-full", isThinkingEnabled ? "bg-[#a78bfa]" : "bg-[#632CA6]")}
                        animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
                      />
                      <motion.div
                        className={cn("w-1.5 h-1.5 rounded-full", isThinkingEnabled ? "bg-[#a78bfa]" : "bg-[#632CA6]")}
                        animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
                      />
                    </div>
                    <span className="text-xs text-white/50 font-mono uppercase tracking-widest ml-1">
                      {isThinkingEnabled ? 'AI is thinking deeply' : (currentExercise?.isQuiz ? 'Coach is analyzing' : 'Customer is typing')}
                    </span>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-[#111] border-t border-white/10">
              <div className="relative max-w-3xl mx-auto">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={isEnded ? "Debrief received — ask a follow-up or continue the conversation..." : (currentExercise?.isQuiz ? "Type your answer..." : "Type your response as the presales engineer...")}
                  className="w-full bg-[#191919] border border-white/10 rounded-2xl py-4 pl-6 pr-14 focus:outline-none focus:border-[#632CA6] focus:ring-1 focus:ring-[#632CA6] transition-all placeholder:text-white/20"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-[#632CA6] hover:bg-[#7742E6] disabled:opacity-50 disabled:hover:bg-[#632CA6] rounded-xl transition-all shadow-lg shadow-[#632CA6]/20"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
              <div className="flex items-center justify-center gap-4 mt-3">
                <p className="text-[10px] text-white/20 font-mono uppercase tracking-widest">
                  Press Enter to send • Stay in character
                </p>
                <div className="h-1 w-1 bg-white/10 rounded-full" />
                <p className="text-[10px] text-white/40 font-mono uppercase tracking-widest flex items-center gap-1">
                  <Globe className="w-2 h-2" /> {selectedLanguage.name}
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-8 text-center text-white/20 text-xs font-mono space-y-1">
        <p>© 2026 Datadog Presales Practice Simulator • Built for DPN Excellence</p>
        {process.env.NEXT_PUBLIC_DD_VERSION && (
          <p className="text-white/10">
            v{process.env.NEXT_PUBLIC_DD_VERSION}
          </p>
        )}
      </footer>
    </div>
  );
}
