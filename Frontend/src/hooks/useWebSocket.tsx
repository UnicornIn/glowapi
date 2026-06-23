  "use client"

  import {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    ReactNode,
  } from "react"
  import { useAuth } from "../contexts/AuthContext"
  import { useTenantConfig } from "../config/TenantConfigContext"

  interface Message {
    user_id: string
    conversation_id: string
    platform: 'whatsapp' | 'instagram' | 'facebook' | 'tiktok' | 'messenger'
    text: string
    timestamp: string
    direction: string
    remitente: string
  }

  interface WebSocketContextType {
    messages: Message[]
    sendMessage: (msg: any) => void
  }

  const WebSocketContext = createContext<WebSocketContextType | null>(null)

  interface WebSocketProviderProps {
    children: ReactNode
  }

  export const WebSocketProvider = ({ children }: WebSocketProviderProps) => {
    const { user } = useAuth()
    const { brand } = useTenantConfig()
    const [messages, setMessages] = useState<Message[]>([])
    const socketRef = useRef<WebSocket | null>(null)

    useEffect(() => {
      if (!user || !brand.wsUrl) return

      const socket = new WebSocket(brand.wsUrl)

      socket.onopen = () => {
        console.log("WebSocket conectado")
      }

      socket.onmessage = (event) => {
        try {
          let newMessage: Message = JSON.parse(event.data)

          if (newMessage.platform === "messenger") {
            newMessage = {
              ...newMessage,
              platform: "facebook",
            }
          }

          setMessages((prev) => [...prev, newMessage])
        } catch (error) {
          console.error("Error al parsear mensaje WebSocket:", error)
        }
      }

      socket.onclose = () => {
        console.log("WebSocket desconectado")
      }

      socketRef.current = socket

      return () => {
        socket.close()
      }
    }, [user, brand.wsUrl])

    const sendMessage = (msg: any) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify(msg))
      }
    }

    return (
      <WebSocketContext.Provider value={{ messages, sendMessage }}>
        {children}
      </WebSocketContext.Provider>
    )
  }

  export const useWebSocket = () => {
    const context = useContext(WebSocketContext)
    if (!context)
      throw new Error("useWebSocket debe usarse dentro de WebSocketProvider")
    return context
  }
