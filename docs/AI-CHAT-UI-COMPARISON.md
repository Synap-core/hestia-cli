# AI Chat UI Comparison for Hestia

Hestia offers three optional AI chat interfaces, each with unique strengths and ideal use cases. This guide helps you choose the right one(s) for your needs.

## Quick Comparison

| Feature | LobeChat | Open WebUI | LibreChat |
|---------|----------|------------|-----------|
| **Best For** | Modern UI lovers | Ollama users | ChatGPT migrants |
| **Setup** | Simple | Simple | Moderate |
| **Ollama Integration** | Good | Excellent | Good |
| **Plugin Support** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| **Mobile Support** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ |
| **Voice Input** | ✅ | ✅ | ✅ |
| **Document RAG** | ❌ | ✅ | ✅ |
| **Multi-Model** | ✅ | ✅ | ✅ |
| **User Management** | ❌ | ✅ | ✅ |
| **Port** | 3010 | 3011 | 3012 |

## Detailed Comparison

### LobeChat

**Modern, Beautiful AI Chat Interface**

#### Strengths
- **Polished UI/UX**: Best-in-class modern interface design
- **Plugin Ecosystem**: Extensive marketplace of community plugins
- **Agent Framework**: Built-in support for custom AI agents
- **Mobile-Responsive**: Excellent mobile experience
- **Multiple Providers**: Native support for Ollama, OpenAI, Anthropic, Google, Azure
- **Voice Input**: Built-in speech-to-text support

#### Limitations
- **No Built-in RAG**: Requires plugins for document context
- **No User Management**: Single-user focused
- **No Document Upload**: Can't chat with documents natively

#### Ideal For
- Users who prioritize visual design and modern UX
- Those who want plugin extensibility
- Users experimenting with AI agents
- Mobile-first users

#### Start Command
```bash
hestia ai:chat:start lobechat
```

---

### Open WebUI

**Native Ollama Integration with RAG**

#### Strengths
- **Native Ollama**: Automatically detects all local Ollama models
- **Built-in RAG**: Upload documents and chat with their content
- **Document Q&A**: PDF, text, and other document support
- **Pipelines**: Custom processing pipelines for advanced workflows
- **Web Search**: Built-in search integration
- **Voice Support**: Voice input and output
- **User Management**: Multi-user support with permissions
- **Function Calling**: Supports tool/function calling

#### Limitations
- **Plugin Ecosystem**: Smaller than LobeChat
- **UI Polish**: Functional but less visually polished than LobeChat

#### Ideal For
- Users who primarily use Ollama
- Those who need document Q&A capabilities
- Users who want built-in web search
- Multi-user households or teams
- Privacy-conscious users (everything stays local)

#### Start Command
```bash
hestia ai:chat:start openwebui
```

---

### LibreChat

**ChatGPT Clone with Multi-Model Support**

#### Strengths
- **ChatGPT-like UI**: Familiar interface for ChatGPT migrants
- **Conversation Branching**: Fork conversations at any point
- **Multi-Endpoint**: Use multiple AI providers simultaneously
- **Preset Management**: Save and share model configurations
- **Message Editing**: Edit any message and regenerate responses
- **Plugin Support**: Extensive plugin ecosystem
- **Conversation Sharing**: Share conversations via links
- **User Management**: Full authentication and multi-user support

#### Limitations
- **Setup Complexity**: More configuration options can be overwhelming
- **Resource Usage**: Higher memory usage than alternatives

#### Ideal For
- Users migrating from ChatGPT who want familiar UX
- Power users who need conversation branching
- Those who switch between multiple AI providers
- Users who need preset/model management
- Teams needing conversation sharing

#### Start Command
```bash
hestia ai:chat:start librechat
```

---

## Decision Guide

### Choose LobeChat if:
- You want the most polished, modern interface
- You care about mobile experience
- You want to experiment with AI agents
- Plugin extensibility is important
- You're okay without document upload

### Choose Open WebUI if:
- You use Ollama as your primary AI backend
- You need to chat with documents (PDFs, text files)
- You want built-in web search
- You need multi-user support
- You want everything to stay local

### Choose LibreChat if:
- You're coming from ChatGPT and want familiar UX
- You need conversation branching/forking
- You use multiple AI providers and want to switch easily
- You want advanced preset management
- You need conversation sharing features

---

## Running Multiple Chat UIs

You can install and run all three simultaneously on different ports:

```bash
# Install all three
hestia ai:chat:install lobechat
hestia ai:chat:install openwebui
hestia ai:chat:install librechat

# Start all
hestia ai:chat:enable-all

# Or start individually
hestia ai:chat:start lobechat    # http://localhost:3010
hestia ai:chat:start openwebui   # http://localhost:3011
hestia ai:chat:start librechat   # http://localhost:3012
```

## Connecting to AI Backends

All three chat UIs can connect to Hestia's AI backends:

### Ollama (Local)
- **Endpoint**: `http://ollama:11434`
- **Models**: Automatically detected
- **Best For**: Privacy, no API costs, always available

### OpenClaude (Hestia Builder)
- **Endpoint**: `http://localhost:3002`
- **Features**: Advanced agents, Synap integration
- **Best For**: Using Hestia's intelligence hub

### External Providers
All three support external AI providers (OpenAI, Anthropic, etc.)
Configure via environment variables or UI settings.

## Environment Variables

Each chat UI can be configured via environment variables in:
`/opt/hestia/config/.env`

### Common Variables
```bash
# Ollama connection (used by all)
OLLAMA_API_URL=http://ollama:11434

# Optional external providers
OPENAI_API_KEY=your-key-here
ANTHROPIC_API_KEY=your-key-here
GOOGLE_API_KEY=your-key-here
```

### LobeChat-Specific
```bash
LOBECHAT_ACCESS_CODE=your-access-code
NEXT_PUBLIC_CUSTOM_MODELS=model1,model2,model3
```

### Open WebUI-Specific
```bash
ENABLE_RAG=true
ENABLE_WEB_SEARCH=true
WEB_SEARCH_ENGINE=duckduckgo
```

### LibreChat-Specific
```bash
LIBRECHAT_JWT_SECRET=your-secret
APP_TITLE=My Hestia Chat
```

## Troubleshooting

### Services Won't Start
```bash
# Check logs
hestia ai:chat:logs <provider>

# Check status
hestia ai:chat:list

# Restart
hestia ai:chat:stop <provider>
hestia ai:chat:start <provider>
```

### Can't Connect to Ollama
Ensure Ollama is running:
```bash
# Check Ollama status
curl http://localhost:11434/api/tags

# If not running
hestia ignite
```

### Port Conflicts
Each UI uses a different port (3010, 3011, 3012). If you have conflicts:
```bash
# Check what's using the port
lsof -i :3010

# Reconfigure with different port
hestia ai:chat:config <provider> --set port=3020
```

## Updating

```bash
# Update images
docker pull lobehub/lobe-chat:latest
docker pull ghcr.io/open-webui/open-webui:latest
docker pull ghcr.io/danny-avila/librechat:latest

# Restart services
hestia ai:chat:stop <provider>
hestia ai:chat:start <provider>
```

## Security Considerations

- All services run locally by default (localhost only)
- No data leaves your Hestia instance unless you configure external AI providers
- LobeChat supports access codes for basic protection
- Open WebUI and LibreChat have full user management
- Consider reverse proxy with auth for external access

## Further Resources

- **LobeChat**: https://github.com/lobehub/lobe-chat
- **Open WebUI**: https://github.com/open-webui/open-webui
- **LibreChat**: https://github.com/danny-avila/LibreChat
- **Hestia CLI**: Run `hestia ai:chat --help`
