import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { brand as staticBrand, type Brand } from "./brand";
import { features as staticFeatures, type Features } from "./features";
import { fichas as staticFichas, type FichaConfig } from "./fichas";
import { API_BASE_URL } from "./api";

export interface TenantBrand extends Brand {}
export interface TenantFeatures extends Features {}
export interface TenantFicha extends FichaConfig {}

export interface TenantConfig {
  brand: TenantBrand;
  features: TenantFeatures;
  fichas: TenantFicha[];
  isLoading: boolean;
}

const TenantConfigContext = createContext<TenantConfig | null>(null);

interface TenantConfigProviderProps {
  children: ReactNode;
}

interface BusinessConfigResponse {
  nombre_negocio?: string;
  logo_url?: string;
  color_primario?: string;
  footer_legal?: string;
  razon_social?: string;
  ws_url?: string;
}

export const TenantConfigProvider = ({ children }: TenantConfigProviderProps) => {
  const [config, setConfig] = useState<TenantConfig>({
    brand: staticBrand,
    features: staticFeatures,
    fichas: staticFichas,
    isLoading: true,
  });

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_BASE_URL}public/business-config`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<BusinessConfigResponse>;
      })
      .then((data) => {
        setConfig((prev) => ({
          ...prev,
          isLoading: false,
          brand: {
            ...prev.brand,
            logoUrl: data.logo_url || prev.brand.logoUrl,
            footerLegal: data.footer_legal || prev.brand.footerLegal,
            wsUrl: data.ws_url || prev.brand.wsUrl,
            colors: {
              ...prev.brand.colors,
              ...(data.color_primario
                ? { primary: data.color_primario }
                : {}),
            },
          },
        }));
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.warn(
            "[TenantConfig] No se pudo cargar business-config, usando valores por defecto:",
            err.message,
          );
        }
        setConfig((prev) => ({ ...prev, isLoading: false }));
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--primary", config.brand.colors.primary);
    root.style.setProperty("--secondary", config.brand.colors.secondary);
    root.style.setProperty("--accent", config.brand.colors.accent);
  }, [config.brand.colors]);

  useEffect(() => {
    document.title = config.brand.appName;

    let favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.appendChild(favicon);
    }
    favicon.href = config.brand.faviconUrl;
  }, [config.brand.appName, config.brand.faviconUrl]);

  return (
    <TenantConfigContext.Provider value={config}>
      {children}
    </TenantConfigContext.Provider>
  );
};

export const useTenantConfig = (): TenantConfig => {
  const context = useContext(TenantConfigContext);
  if (!context) {
    throw new Error(
      "useTenantConfig debe usarse dentro de <TenantConfigProvider>. " +
        "Verifica que la app esté envuelta por el Provider (ver App.tsx)."
    );
  }
  return context;
};
