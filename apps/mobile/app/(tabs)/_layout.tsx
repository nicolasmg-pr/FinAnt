import Feather from '@expo/vector-icons/Feather';
import { TopTabs } from 'expo-router/js-top-tabs';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type ColorValue } from 'react-native';
import { AskOverlay } from '../../src/components/AskOverlay';
import { TabBar, type TabBarProps } from '../../src/components/TabBar';
import { useTheme } from '../../src/design';

/** The active tab's icon sits in a filled pill, so the current tab reads from
 * shape as well as from colour. The pill itself is drawn by `TabBar`; this
 * only supplies the glyph. */
function TabIcon({ name, color }: { name: keyof typeof Feather.glyphMap; color: ColorValue }) {
  return <Feather name={name} color={color as string} size={22} />;
}

/**
 * The five tabs are a swipeable pager: a horizontal drag moves to the
 * neighbouring tab and follows the finger, so dashboard, movements, banks,
 * budgets and settings are one continuous surface. That is why this is
 * `TopTabs` — expo-router's material top-tab navigator, the only one of its
 * navigators built on a pager — with its bar moved to the bottom and
 * rewritten (see `TabBar`). The declaration order below is the swipe order.
 *
 * Every tab screen renders its own large title in its scroll body, so none of
 * them keeps a navigator header: a bar repeating the title costs a fifth of
 * the screen and scrolls with nothing.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <View style={styles.root}>
      <TopTabs
        tabBarPosition="bottom"
        tabBar={(props: TabBarProps) => <TabBar {...props} />}
        screenOptions={{
          swipeEnabled: true,
          sceneStyle: { backgroundColor: theme.background },
          // Five screens that each query the database would otherwise all
          // mount at launch. The neighbour is preloaded instead, so the screen
          // a swipe is heading for is already rendered when the finger lands.
          lazy: true,
          lazyPreloadDistance: 1,
        }}
      >
        <TopTabs.Screen
          name="index"
          options={{
            title: t('nav.dashboard'),
            tabBarIcon: ({ color }: { color: ColorValue }) => (
              <TabIcon name="pie-chart" color={color} />
            ),
          }}
        />
        <TopTabs.Screen
          name="transactions"
          options={{
            title: t('nav.transactions'),
            tabBarIcon: ({ color }: { color: ColorValue }) => <TabIcon name="list" color={color} />,
          }}
        />
        <TopTabs.Screen
          name="banks"
          options={{
            title: t('nav.banks'),
            tabBarIcon: ({ color }: { color: ColorValue }) => <TabIcon name="home" color={color} />,
          }}
        />
        <TopTabs.Screen
          name="budgets"
          options={{
            title: t('nav.budgets'),
            tabBarIcon: ({ color }: { color: ColorValue }) => (
              <TabIcon name="target" color={color} />
            ),
          }}
        />
        <TopTabs.Screen
          name="settings"
          options={{
            title: t('nav.settings'),
            tabBarIcon: ({ color }: { color: ColorValue }) => (
              <TabIcon name="settings" color={color} />
            ),
          }}
        />
      </TopTabs>
      {/* Above the navigator, so the bubble survives a tab change rather than
          remounting halfway through a drag. */}
      <AskOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
