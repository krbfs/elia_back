export type VkUserInfo = {
  id: number;
  first_name?: string;
  last_name?: string;
};

export async function verifyVkAccessToken(accessToken: string): Promise<VkUserInfo> {
  const params = new URLSearchParams({
    access_token: accessToken,
    v: process.env.VK_API_VERSION ?? '5.199',
  });

  const response = await fetch(`https://api.vk.com/method/users.get?${params}`);
  if (!response.ok) {
    throw new Error('VK API unavailable');
  }

  const data = (await response.json()) as {
    error?: { error_msg: string };
    response?: Array<{ id: number; first_name?: string; last_name?: string }>;
  };

  if (data.error) {
    throw new Error(data.error.error_msg);
  }

  const user = data.response?.[0];
  if (!user?.id) {
    throw new Error('Invalid VK token');
  }

  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
  };
}
